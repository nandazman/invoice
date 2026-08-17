import { useCallback, useEffect, useState, type ReactNode } from "react";
// Sync actions and pending counts are not imported here on purpose: they live
// in the sync chip now (see components/SyncChip.tsx). This page is roles and
// the D1 dashboard, nothing else.
import { useSyncStatus, type SyncStatus } from "../lib/sync/client";
import {
  formatAngka,
  formatBytes,
  formatDateTimeID,
  formatRelatifID,
} from "../lib/format";
import { PrimaryButton, DangerButton } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { Input } from "../components/Input";
import { Stat } from "../components/Stat";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

// Two roles, and being on the list is itself the grant — see
// docs/2026-08-15/permissions-plan.md decision 3. `none` is not a role the
// server stores; it is the answer for an email that has no row, and it means
// blocked, not "may look but not save".
type Grant = "write" | "admin";
type Role = Grant | "none";

// The wire value is widened to a string on the way in so a role this build does
// not know about — an old 'read' row read by a client that has not reloaded
// since the migration — lands on `none` (blocked) rather than rendering
// `undefined` in a badge. Failing closed is the right direction here.
function asRole(raw: string): Role {
  return raw === "admin" ? "admin" : raw === "write" ? "write" : "none";
}

// Role labels live here rather than in client.ts because they are pixels, not
// protocol: the Worker only ever sees the wire values.
const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  write: "Pengguna",
  none: "Tidak punya akses",
};

// Badge colours track severity, not identity: `none` is the only state that is
// a problem, so it is the only warm one. Palette is the same slate/blue/amber
// already used across the app.
const ROLE_BADGE: Record<Role, string> = {
  admin: "bg-blue-50 text-blue-700 border-blue-200",
  write: "bg-emerald-50 text-emerald-700 border-emerald-200",
  none: "bg-amber-50 text-amber-700 border-amber-200",
};

// What a role actually lets someone do, in consequences rather than in nouns.
// Used by the confirmation dialogs, which have to answer "and then what?" — a
// dialog that only names the new role has told the reader nothing they did not
// already see on the checkbox.
const ROLE_EFFECT: Record<Role, string> = {
  // Says nothing about the cloud any more: whether what this person writes
  // leaves their device is the `canPush` flag's business, and PUSH_EFFECT is
  // shown right below this in every dialog that hands out a role.
  write:
    "Pengguna memakai aplikasi ini sepenuhnya: melihat semua data, mencatat, dan mengubah.",
  admin:
    "Admin memakai aplikasi ini sepenuhnya, ditambah halaman pengaturan ini — daftar peran dan kondisi database, termasuk memberi dan mencabut akses orang lain, Anda sendiri termasuk.",
  none: "Tanpa peran, orang ini tidak bisa memakai aplikasi sama sekali: permintaannya ditolak server dan layarnya kosong.",
};

// Rank only exists to tell a promotion from a demotion, so the dialog can wear
// danger styling when abilities are being taken away rather than given.
const ROLE_RANK: Record<Role, number> = { none: 0, write: 1, admin: 2 };

// Indonesian names for the wire table names in tables.ts. Kept out of that file
// on purpose — it is compiled by the Worker too, and the Worker has no UI.
const TABLE_LABEL: Record<string, string> = {
  products: "Produk",
  orders: "Pesanan",
  purchases: "Pembelian",
  stock: "Stok",
  buyers: "Pembeli",
  templates: "Template",
  audit: "Riwayat",
  types: "Tipe",
};

function tableLabel(name: string): string {
  return TABLE_LABEL[name] ?? name;
}

// ---------- admin API ----------

// `role` is the raw wire string on both of these, narrowed with asRole() at the
// point of use — see the note on asRole.
interface Me {
  email: string;
  role: string;
}

interface RoleRow {
  email: string;
  role: string;
  createdAt: string;
  createdBy: string;
  lastSeenAt: string | null;
  // Whether this person's changes leave their device. Independent of `role` —
  // an admin can be local-only and a plain user can publish.
  canPush: boolean;
}

interface TableStat {
  table: string;
  live: number;
  deleted: number;
  lastWriteAt: string | null;
}

interface RecentRow {
  table: string;
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  deleted?: boolean;
}

interface PersonSeen {
  email: string;
  role: string;
  lastSeenAt: string | null;
}

interface AdminStats {
  tables: TableStat[];
  recent: RecentRow[];
  // Bytes, straight from D1's query metadata. Null if the server could not
  // report it — every field here is best effort, never a reason to blank the
  // whole panel.
  size: number | null;
  volume: { day: number; week: number };
  people: PersonSeen[];
}

// Every failure the page can render carries a machine code, because the three
// interesting cases (session lapsed, not the owner, everything else) are told
// apart by code and status — never by matching on the message text.
class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Cloudflare Access answers an expired session with an HTML login page, not
// JSON, so parsing before checking the content-type would turn "please reload"
// into a SyntaxError about an unexpected "<". Check first, always.
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // `redirect: "manual"` for the same reason as in sync/client.ts: an expired
    // Access session redirects to another origin, following it fails CORS, and a
    // rejected fetch here would be reported as "server unreachable" when the
    // server is fine and the session is not.
    res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      redirect: "manual",
    });
  } catch {
    throw new ApiFailure(0, "offline", "Tidak bisa menghubungi server.");
  }
  // Opaque: the redirect was stopped rather than followed. No headers to read,
  // so this has to come before the content-type check.
  if (res.type === "opaqueredirect" || res.status === 0) {
    throw new ApiFailure(
      401,
      "unauthenticated",
      // Plain text, because an ApiFailure is thrown from a non-React module.
      // messageOf() replaces it with the version carrying the login link
      // wherever it is rendered; this is the fallback if anything ever prints
      // the raw error.
      "Sesi Cloudflare Access sudah berakhir. Buka /api/admin/login untuk masuk lagi.",
    );
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // `res.redirected` is gone from this check: with redirect "manual" it can
    // never be true, and a redirect is caught above. What is left is Access
    // serving its login page as a 200 (or the API answering 401/403 in HTML).
    if (res.status === 401 || res.status === 403) {
      throw new ApiFailure(
        401,
        "unauthenticated",
        // Plain text, because an ApiFailure is thrown from a non-React module.
      // messageOf() replaces it with the version carrying the login link
      // wherever it is rendered; this is the fallback if anything ever prints
      // the raw error.
      "Sesi Cloudflare Access sudah berakhir. Buka /api/admin/login untuk masuk lagi.",
      );
    }
    throw new ApiFailure(
      res.status,
      "bad_response",
      `Server membalas dengan format yang tidak dikenal (${res.status}).`,
    );
  }
  const body: unknown = await res.json();
  if (!res.ok) {
    const err = body as Partial<{ code: string; message: string }>;
    throw new ApiFailure(
      res.status,
      err.code ?? "error",
      err.message ?? `Permintaan gagal (${res.status}).`,
    );
  }
  return body as T;
}

// A lapsed Access session is the one error whose fix is not "coba lagi", and it
// is not "reload" either — that instruction was wrong, and wrong in a way that
// loops. The owner-only Access application over /api/admin/* keeps a session of
// its own, separate from the one guarding the hostname; a reload is a
// navigation to /, which the hostname application passes through on its own
// still-valid session without the owner-only one being consulted at all. You
// land back here and get this message again.
//
// A link, not a button: it has to be a real top-level navigation to a path
// Access guards, so Access can take the browser through its login and send it
// back. See /api/admin/login in worker/index.ts. The page tries that navigation
// automatically on load (bounceToAccessLogin); this is what is left when the
// automatic attempt is not available or has already been spent.
function messageOf(e: unknown): ReactNode {
  if (e instanceof ApiFailure && e.code === "unauthenticated") {
    return (
      <>
        Sesi Cloudflare Access sudah berakhir.{" "}
        <a href="/api/admin/login" className="underline">
          Masuk lagi
        </a>{" "}
        untuk melanjutkan.
      </>
    );
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------- page ----------

export function AdminPage() {
  const status = useSyncStatus();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Sinkronisasi</h1>
      <p className="text-slate-500 mb-4">
        Siapa Anda, apa yang sudah tersimpan di cloud, dan apa yang masih
        tertinggal di perangkat ini.
      </p>

      {status.available ? (
        <AdminSections status={status} />
      ) : (
        <Panel>
          <h2 className="text-lg font-bold mb-1">Salinan tanpa cloud</h2>
          <p className="text-sm text-slate-500">
            Salinan aplikasi ini tidak terhubung ke server, jadi tidak ada
            sinkronisasi. Semua data tersimpan di browser perangkat ini saja —
            aplikasinya tetap berjalan penuh. Gunakan tombol “Backup semua” di
            bawah menu kiri kalau ingin menyalin datanya keluar.
          </p>
        </Panel>
      )}
    </div>
  );
}

// Marks that this tab has already spent its automatic bounce through Access.
// sessionStorage rather than a module variable: the bounce is a full page load,
// so anything held in memory is gone by the time it would be read back.
const BOUNCE_KEY = "invoice.admin-access-bounce";

// Send the browser through Access to renew the owner-only session, without
// making the user click anything. Returns whether the navigation was started —
// callers must not render an error when it was, because the page is leaving.
//
// ONE ATTEMPT PER TAB, and the guard is the entire reason this is safe to do
// automatically. The bounce returns to #/admin, which refetches on mount; if
// that fetch is still unauthenticated — Access misconfigured off this path,
// third-party cookies blocked, a policy that will never pass this identity —
// an ungated version navigates away again, forever, with no frame in between
// long enough to read a message or reach the Back button. Spending the attempt
// converts that infinite loop into exactly one wasted round trip followed by a
// message with a link in it.
function bounceToAccessLogin(): boolean {
  try {
    if (sessionStorage.getItem(BOUNCE_KEY)) return false;
    sessionStorage.setItem(BOUNCE_KEY, "1");
  } catch {
    // Storage disabled or full. Refuse rather than bounce: a loop that cannot
    // record that it happened is the one case the guard above exists to stop.
    return false;
  }
  // Absolute from the root, matching the Access application's path. Not built
  // from a base path — the only build with a Worker behind it is the Cloudflare
  // one, which is mounted at /. On GitHub Pages there is no API at all, the
  // admin page never reaches this, and sync reports itself unavailable instead.
  window.location.href = "/api/admin/login";
  return true;
}

function AdminSections({ status }: { status: SyncStatus }) {
  // Whether this Access identity is the owner. Unknown until /api/admin/me
  // answers; 403 means "signed in, just not you" and must still leave sections
  // 1–4 on screen, because a non-owner is entitled to all of those.
  const [owner, setOwner] = useState<boolean | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  // ReactNode, not string: a lapsed session renders as text plus a login link
  // (messageOf), and that is the whole point of the message.
  const [adminError, setAdminError] = useState<ReactNode>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<Me>("/api/admin/me")
      .then((data) => {
        if (!alive) return;
        setMe(data);
        setOwner(true);
        setAdminError(null);
        // Session is good, so give this tab its automatic bounce back. Without
        // this the guard is one-per-tab for the lifetime of the tab, and the
        // second expiry of a long-lived tab would be handled by hand.
        try {
          sessionStorage.removeItem(BOUNCE_KEY);
        } catch {
          // Nothing was stored if storage is unavailable.
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // Renew the session without making anyone read an error first. When
        // this takes, the page is already navigating — setting state now would
        // flash the failure on the way out.
        if (
          e instanceof ApiFailure &&
          e.code === "unauthenticated" &&
          bounceToAccessLogin()
        ) {
          return;
        }
        setOwner(false);
        // 403 is not an error to shout about — it is the normal answer for
        // someone who is not an admin. Anything else is worth printing.
        setAdminError(
          e instanceof ApiFailure && e.status === 403 ? null : messageOf(e),
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <IdentityPanel status={status} me={me} />
      {owner === false && (
        <Panel>
          <h2 className="text-lg font-bold mb-1">Pengaturan pemilik</h2>
          <p className="text-sm text-slate-500">
            {adminError ??
              "Anda tidak berwenang membuka pengaturan peran dan aktivitas. Bagian itu hanya untuk pemilik aplikasi."}
          </p>
        </Panel>
      )}
      {owner === true && (
        <>
          <RolesPanel />
          <ActivityPanel />
        </>
      )}
    </>
  );
}

// ---------- 1. Identitas ----------

function IdentityPanel({ status, me }: { status: SyncStatus; me: Me | null }) {
  // status.email comes from the sync endpoint, me.email from the admin one.
  // They are the same Access identity; prefer whichever has arrived.
  const email = me?.email ?? status.email;
  const role = asRole(me?.role ?? status.role);
  return (
    <Panel>
      <h2 className="text-lg font-bold mb-3">Identitas</h2>
      <div className="flex gap-6 flex-wrap items-start">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
            Email
          </div>
          <div className="text-lg font-bold">
            {email || <span className="text-slate-400">—</span>}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
            Peran
          </div>
          <span
            className={`inline-block mt-1 px-2.5 py-1 text-sm font-semibold rounded-lg border ${ROLE_BADGE[role]}`}
          >
            {ROLE_LABEL[role]}
          </span>
        </div>
      </div>
      {/* Guarded on roleKnown, not on the role alone. Before /api/sync/me
          answers, `status.role` is the unanswered default "none" — showing the
          warning then would tell an admin on slow signal that they have no
          access, seconds before their own roles panel loads. Once the server
          has answered, a real "none" cannot get this far anyway: the gate
          screen catches it. This is the last-resort branch, not the usual
          path. */}
      {status.roleKnown && role === "none" && (
        <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Email Anda belum diberi peran, jadi data di perangkat ini tidak
          tersambung ke cloud. Hubungi pemilik aplikasi untuk minta akses.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Identitas diambil dari Cloudflare Access. Tidak ada kata sandi terpisah
        di aplikasi ini — kalau emailnya salah, keluar dari Access lalu masuk
        lagi.
      </p>
    </Panel>
  );
}

// ---------- 2. Peran ----------

// The pending confirmation, carrying everything the dialog needs to describe
// what is about to happen. Held as one value rather than three booleans so the
// copy can name the exact email and the exact before/after role.
// `role`/`next` are Grant, not Role: `none` is what the server answers for an
// email with no row, and it is reached by deleting the row (kind: "remove"),
// never by writing it — so it cannot be the target of an add or a change.
type RoleAction =
  | { kind: "add"; email: string; role: Grant; canPush: boolean }
  | { kind: "change"; row: RoleRow; next: Grant }
  | { kind: "push"; row: RoleRow; next: boolean }
  | { kind: "remove"; row: RoleRow };

// What turning "Kirim ke cloud" on or off actually does, in consequences. Same
// job as ROLE_EFFECT: a dialog that only repeats the switch's own label has
// told the reader nothing.
const PUSH_EFFECT: Record<"on" | "off", string> = {
  on: "Mulai sekarang setiap catatannya dikirim ke cloud dan terlihat oleh semua orang — termasuk yang sudah dia catat selama tombol ini mati, karena semuanya masih tersimpan di perangkatnya dan ikut terkirim pada sinkronisasi berikutnya.",
  off: "Mulai sekarang catatannya berhenti di perangkatnya sendiri: aplikasinya tetap jalan penuh dan dia tetap menerima data terbaru dari cloud, tapi tidak ada lagi yang dia kirim ke sana. Server menolak pengirimannya, jadi ini berlaku walaupun aplikasinya sedang terbuka.",
};

// The only thing left to choose per person. Being on the list already grants
// full use of the app (decision 3), so `admin` is a checkbox rather than a
// second entry in a dropdown of one.
function grantOf(admin: boolean): Grant {
  return admin ? "admin" : "write";
}

// Narrow a stored role back to something the API will accept, for the PUTs that
// are not about the role at all. Being on the table means 'write' or 'admin';
// anything else is a value this build does not recognise, and 'write' is the
// honest reading of it — it is exactly what being on the list grants.
function asGrant(raw: string): Grant {
  return asRole(raw) === "admin" ? "admin" : "write";
}

// Shown next to the Admin checkbox and again inside any dialog that hands out
// the role. Two places, one wording: the warning has to be readable before the
// click and still be there at the moment of confirming.
function AdminAccessWarning() {
  return (
    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <strong>Centang Admin saja belum cukup.</strong> Halaman ini dijaga
      Cloudflare Access dengan daftar terpisah yang hanya berisi pemilik, jadi
      orang yang baru dicentang di sini tetap ditolak Access sebelum sampai ke
      server. Supaya benar-benar berlaku, tambahkan juga emailnya ke policy
      aplikasi Access khusus admin di dashboard Cloudflare.
    </p>
  );
}

function RolesPanel() {
  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  // The add form defaults to plain use. An admin grant is the rarer and the
  // more expensive mistake, so it is never the value someone gets by not
  // looking at the form.
  const [admin, setAdmin] = useState(false);
  // Defaults ON, matching the column default in migration 0003 and the
  // behaviour every existing account has. Local-only is the deliberate,
  // unusual choice, so it is never what someone gets by not looking.
  const [canPush, setCanPush] = useState(true);
  const [pending, setPending] = useState<RoleAction | null>(null);

  const load = useCallback(async () => {
    try {
      // The endpoint answers `{ roles: [...] }`, not a bare array — every
      // response in this API is a JSON object so error and success bodies
      // parse the same way.
      const data = await apiFetch<{ roles: RoleRow[] }>("/api/admin/roles");
      setRows(Array.isArray(data.roles) ? data.roles : []);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The server refuses to demote or remove the last admin and answers 409. That
  // message is the whole point of the guard, so it is shown verbatim rather
  // than replaced with a generic "gagal".
  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  // `push` is left OUT of the body when it is undefined, and the server reads
  // that as "leave it alone" — which is what keeps a role change from quietly
  // re-publishing somebody who had been set to local-only.
  function put(address: string, next: Grant, push?: boolean) {
    return apiFetch("/api/admin/roles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: address,
        role: next,
        ...(push === undefined ? {} : { canPush: push }),
      }),
    });
  }

  // Nothing in this panel writes on the click itself — every entry point only
  // stages a RoleAction, and this is the single place that carries one out.
  function confirmed() {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === "add") {
      void mutate(async () => {
        await put(action.email, action.role, action.canPush);
        setEmail("");
      });
    } else if (action.kind === "change") {
      void mutate(() => put(action.row.email, action.next));
    } else if (action.kind === "push") {
      // The role rides along unchanged: PUT is an upsert on the whole row, so
      // it has to be sent, and sending the current one makes this a no-op for
      // the ladder.
      void mutate(() =>
        put(action.row.email, asGrant(action.row.role), action.next),
      );
    } else {
      void mutate(() =>
        apiFetch(
          `/api/admin/roles?email=${encodeURIComponent(action.row.email)}`,
          { method: "DELETE" },
        ),
      );
    }
  }

  function askAdd() {
    const address = email.trim().toLowerCase();
    if (!address) return;
    setPending({
      kind: "add",
      email: address,
      role: grantOf(admin),
      canPush,
    });
  }

  // Toggling the box back to the value it already had is not a change worth a
  // dialog — and a PUT that rewrites the same role would still count against
  // the last-admin guard for no reason.
  function askChange(row: RoleRow, nextAdmin: boolean) {
    const next = grantOf(nextAdmin);
    if (next === asRole(row.role)) return;
    setPending({ kind: "change", row, next });
  }

  function askPush(row: RoleRow, next: boolean) {
    if (next === row.canPush) return;
    setPending({ kind: "push", row, next });
  }

  return (
    <Panel>
      <h2 className="text-lg font-bold mb-1">Peran</h2>
      <p className="text-sm text-slate-500 mb-3">
        Siapa saja yang boleh memakai aplikasi ini. Ada di daftar berarti bisa
        memakainya sepenuhnya — melihat, mencatat, dan mengubah. Centang Admin
        kalau orangnya juga boleh membuka halaman ini, dan matikan “Kirim ke
        cloud” kalau catatannya cukup tersimpan di perangkatnya sendiri.
      </p>

      <div className="flex gap-3 flex-wrap items-end mb-2">
        <Field label="Email" className="flex-1 min-w-[220px]">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@contoh.com"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm h-9 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-blue-600"
            checked={admin}
            onChange={(e) => setAdmin(e.target.checked)}
          />
          Admin
        </label>
        <label className="flex items-center gap-2 text-sm h-9 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-blue-600"
            checked={canPush}
            onChange={(e) => setCanPush(e.target.checked)}
          />
          Kirim ke cloud
        </label>
        <PrimaryButton onClick={askAdd} disabled={busy || email.trim() === ""}>
          + Tambah / Ubah
        </PrimaryButton>
      </div>

      {/* Decision 5 in permissions-plan.md: the admin Access application in
          front of /api/admin/* still lists only the owner, so a grant made here
          is stopped by Access before the Worker ever runs. Without this notice
          the checkbox looks like it worked and the feature reads as a bug. */}
      <AdminAccessWarning />

      {rows === null && !error ? (
        <p className="text-sm text-slate-400 py-4 text-center">Memuat…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thClass}>Email</th>
                <th className={thClass}>Peran</th>
                <th className={thClass}>Admin</th>
                <th className={thClass}>Kirim ke cloud</th>
                <th className={thClass}>Ditambahkan</th>
                <th className={thClass}>Oleh</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.email} className="hover:bg-slate-50">
                  <td className={`${tdClass} font-medium`}>{r.email}</td>
                  <td className={tdClass}>
                    <span
                      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-md border ${ROLE_BADGE[asRole(r.role)]}`}
                    >
                      {ROLE_LABEL[asRole(r.role)]}
                    </span>
                  </td>
                  <td className={tdClass}>
                    {/* Unchecking is a demotion to plain use, not a removal —
                        "Cabut" is the only thing that takes someone off the
                        list. */}
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      aria-label={`Jadikan ${r.email} admin`}
                      checked={asRole(r.role) === "admin"}
                      disabled={busy}
                      onChange={(e) => askChange(r, e.target.checked)}
                    />
                  </td>
                  <td className={tdClass}>
                    {/* Off is a real state worth seeing at a glance, not just
                        an empty box: an unchecked box reads as "nothing set
                        here", and this one means "this person's data never
                        leaves their laptop". */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        aria-label={`Kirim perubahan ${r.email} ke cloud`}
                        checked={r.canPush}
                        disabled={busy}
                        onChange={(e) => askPush(r, e.target.checked)}
                      />
                      {!r.canPush && (
                        <span className="inline-block px-2 py-0.5 text-xs font-semibold rounded-md border bg-slate-50 text-slate-600 border-slate-200">
                          Lokal saja
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${tdClass} text-slate-500`}>
                    {formatDateTimeID(r.createdAt)}
                  </td>
                  <td className={`${tdClass} text-slate-500`}>
                    {r.createdBy || <span className="text-slate-400">—</span>}
                  </td>
                  <td className={tdClass}>
                    <div className="flex gap-1 justify-end">
                      <DangerButton
                        size="sm"
                        disabled={busy}
                        onClick={() => setPending({ kind: "remove", row: r })}
                      >
                        Cabut
                      </DangerButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="text-center text-slate-400 py-8">
          Belum ada peran yang terdaftar.
        </div>
      )}

      {pending?.kind === "add" && (
        <ConfirmDialog
          title="Beri akses ke email ini?"
          confirmLabel="Ya, simpan peran"
          busy={busy}
          onConfirm={confirmed}
          onClose={() => setPending(null)}
        >
          <p>
            <strong>{pending.email}</strong> akan diberi peran{" "}
            <strong>{ROLE_LABEL[pending.role]}</strong>.
          </p>
          <p>{ROLE_EFFECT[pending.role]}</p>
          <p>{PUSH_EFFECT[pending.canPush ? "on" : "off"]}</p>
          <p>
            Kalau email itu sudah ada di daftar, peran lamanya diganti dengan
            yang ini. Berlaku langsung, dan bisa diubah atau dicabut kapan saja.
          </p>
          {pending.role === "admin" && <AdminAccessWarning />}
        </ConfirmDialog>
      )}

      {pending?.kind === "change" && (
        <ConfirmDialog
          // Taking abilities away deserves the red treatment; handing them out
          // does not.
          danger={ROLE_RANK[pending.next] < ROLE_RANK[asRole(pending.row.role)]}
          title="Ubah peran orang ini?"
          confirmLabel="Ya, ubah peran"
          busy={busy}
          onConfirm={confirmed}
          onClose={() => setPending(null)}
        >
          <p>
            <strong>{pending.row.email}</strong> berubah dari{" "}
            <strong>{ROLE_LABEL[asRole(pending.row.role)]}</strong> menjadi{" "}
            <strong>{ROLE_LABEL[pending.next]}</strong>.
          </p>
          <p>{ROLE_EFFECT[pending.next]}</p>
          <p>
            Berlaku seketika — server memeriksa ulang peran setiap kali ada
            pengiriman data, jadi orangnya tidak perlu masuk ulang. Data yang
            sudah pernah dia kirim tetap ada dan tidak berubah.
          </p>
          {/* Otherwise a promotion looks like it failed: the new admin's data
              still never appears in the cloud, and nothing on this page said
              the two settings were separate. */}
          {!pending.row.canPush && (
            <p>
              Perlu diingat: “Kirim ke cloud” untuk orang ini tetap mati, jadi
              catatannya masih berhenti di perangkatnya sendiri. Peran dan
              pengiriman diatur terpisah.
            </p>
          )}
          {pending.next === "admin" && <AdminAccessWarning />}
        </ConfirmDialog>
      )}

      {pending?.kind === "push" && (
        <ConfirmDialog
          // Turning it off takes an ability away, and does it to data that only
          // exists on somebody else's laptop — the red treatment is earned.
          danger={!pending.next}
          title={
            pending.next
              ? "Mulai kirim perubahan orang ini ke cloud?"
              : "Setop pengiriman ke cloud untuk orang ini?"
          }
          confirmLabel={pending.next ? "Ya, kirim ke cloud" : "Ya, simpan lokal saja"}
          busy={busy}
          onConfirm={confirmed}
          onClose={() => setPending(null)}
        >
          <p>
            <strong>{pending.row.email}</strong>{" "}
            {pending.next
              ? "akan mengirim perubahannya ke cloud."
              : "berhenti mengirim perubahannya ke cloud."}
          </p>
          <p>{PUSH_EFFECT[pending.next ? "on" : "off"]}</p>
          {!pending.next && (
            <p className="font-semibold text-red-700">
              Risikonya ada di orangnya: tanpa salinan di cloud, catatan yang
              hanya ada di perangkatnya akan hilang kalau riwayat browser
              dibersihkan atau perangkatnya diganti. Ingatkan dia untuk memakai
              “Backup semua” secara berkala.
            </p>
          )}
          <p>
            Perannya tidak berubah, dan data yang sudah pernah dia kirim tetap
            ada di cloud.
          </p>
        </ConfirmDialog>
      )}

      {pending?.kind === "remove" && (
        <ConfirmDialog
          danger
          title="Cabut akses orang ini?"
          confirmLabel="Ya, cabut akses"
          busy={busy}
          onConfirm={confirmed}
          onClose={() => setPending(null)}
        >
          <p className="font-semibold text-red-700">
            <strong>{pending.row.email}</strong> tidak akan bisa lagi mengambil
            data dari cloud maupun mengirim perubahan ke sana. Permintaan
            berikutnya dari dia langsung ditolak server.
          </p>
          <p>
            Data yang sudah pernah dia kirim tetap ada di cloud — tidak ada
            satu baris pun yang ikut terhapus.
          </p>
          <p>
            Yang tidak bisa ditarik: salinan data yang sudah terlanjur
            tersimpan di browser perangkatnya. Mencabut akses menutup pintu ke
            depan, bukan menghapus yang sudah lewat.
          </p>
          <p>Aksesnya bisa diberikan lagi kapan saja lewat form di atas.</p>
        </ConfirmDialog>
      )}

      {error && (
        <p className="mt-3 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </Panel>
  );
}

// ---------- 3. Aktivitas ----------

function ActivityPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<ReactNode>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<AdminStats>("/api/admin/stats")
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch((e: unknown) => {
        if (alive) setError(messageOf(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <Panel>
        <h2 className="text-lg font-bold mb-1">Aktivitas</h2>
        <p className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error}
        </p>
      </Panel>
    );
  }

  const recent = stats?.recent ?? [];
  const tables = stats?.tables ?? [];
  const people = stats?.people ?? [];

  return (
    <Panel>
      <h2 className="text-lg font-bold mb-1">Aktivitas</h2>
      <p className="text-sm text-slate-500 mb-3">
        Isi cloud dan perubahan terakhir yang masuk. Kolom “oleh” diisi server
        dari email Cloudflare Access pengirimnya, bukan dari perangkat, jadi
        tidak bisa dipalsukan.
      </p>

      {stats === null ? (
        <p className="text-sm text-slate-400 py-4 text-center">Memuat…</p>
      ) : (
        <>
          {/* Ukuran database lebih dulu: templat menyimpan logo base64, jadi
              angka inilah yang paling cepat jadi masalah. */}
          <div className="flex gap-6 flex-wrap mb-4">
            <Stat label="Ukuran database" value={formatBytes(stats.size)} />
            <Stat
              label="Perubahan 24 jam"
              value={`${formatAngka(stats.volume.day)} baris`}
            />
            <Stat
              label="Perubahan 7 hari"
              value={`${formatAngka(stats.volume.week)} baris`}
            />
          </div>

          <div className="overflow-x-auto mb-4">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tabel</th>
                  <th className={`${thClass} text-right`}>Baris aktif</th>
                  <th className={`${thClass} text-right`}>Terhapus</th>
                  <th className={`${thClass} text-right`}>Tulisan terakhir</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.table} className="hover:bg-slate-50">
                    <td className={tdClass}>{tableLabel(t.table)}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(t.live)}
                    </td>
                    <td
                      className={`${tdClass} text-right tabular-nums text-slate-500`}
                    >
                      {formatAngka(t.deleted)}
                    </td>
                    {/* `types` diganti utuh setiap kali dikirim, jadi tidak
                        punya kolom waktu sama sekali — server mengirim null,
                        dan itu bukan tanda tabelnya diam. */}
                    <td
                      className={`${tdClass} text-right text-slate-500 whitespace-nowrap`}
                    >
                      {t.lastWriteAt ? (
                        formatRelatifID(t.lastWriteAt)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="font-semibold mb-1">Pemakaian akses</h3>
          <p className="text-sm text-slate-500 mb-2">
            Kapan terakhir setiap orang di daftar peran membuka aplikasi ini.
            Dicatat sekali tiap sesi, waktu aplikasinya dibuka — bukan tiap kali
            data terkirim.
          </p>
          <div className="overflow-x-auto mb-4">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Email</th>
                  <th className={thClass}>Peran</th>
                  <th className={`${thClass} text-right`}>Terakhir membuka</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.email} className="hover:bg-slate-50">
                    <td className={`${tdClass} font-medium`}>{p.email}</td>
                    <td className={tdClass}>{ROLE_LABEL[asRole(p.role)]}</td>
                    {/* NULL berarti aksesnya belum pernah dipakai sama sekali —
                        kolom kosong akan terbaca sebagai data yang hilang,
                        bukan sebagai jawaban. */}
                    <td
                      className={`${tdClass} text-right text-slate-500 whitespace-nowrap`}
                    >
                      {p.lastSeenAt ? (
                        formatRelatifID(p.lastSeenAt)
                      ) : (
                        <span className="text-amber-700">Belum pernah dipakai</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ten rows, from the server (worker/sync.ts). The heading says the
              number out loud so nobody reads a short list as "sync is quiet"
              when it is really just the cap. */}
          <h3 className="font-semibold mb-1">10 perubahan terakhir</h3>
          <p className="text-sm text-slate-500 mb-2">
            Sekilas untuk memastikan sinkronisasi memang jalan — bukan riwayat
            lengkap. Hanya 10 baris terbaru yang ditampilkan; catatan
            selengkapnya ada di halaman Riwayat.
          </p>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              Belum ada perubahan yang tercatat di cloud.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={thClass}>Waktu</th>
                    <th className={thClass}>Tabel</th>
                    <th className={thClass}>Baris</th>
                    <th className={thClass}>Oleh</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={`${r.table}:${r.id}`} className="hover:bg-slate-50">
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {formatDateTimeID(r.updatedAt)}
                      </td>
                      <td className={tdClass}>
                        {tableLabel(r.table)}
                        {r.deleted && (
                          <span className="ml-2 text-xs font-semibold text-rose-600">
                            dihapus
                          </span>
                        )}
                      </td>
                      <td className={`${tdClass} text-slate-500 font-mono text-xs`}>
                        {r.id}
                      </td>
                      <td className={tdClass}>
                        {r.updatedBy || <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
