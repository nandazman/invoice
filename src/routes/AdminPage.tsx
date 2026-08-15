import { useCallback, useEffect, useState } from "react";
import {
  useSyncStatus,
  syncNow,
  pullNow,
  discardLocalChanges,
  isScratchMode,
  setScratchMode,
  canWrite,
  type SyncStatus,
  type Role,
} from "../lib/sync/client";
import { TABLES } from "../lib/sync/tables";
import { formatAngka, formatDateTimeID } from "../lib/format";
import { Button, PrimaryButton, DangerButton } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { Stat } from "../components/Stat";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

// Role labels live here rather than in client.ts because they are pixels, not
// protocol: the Worker only ever sees the four wire values.
const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  write: "Penulis",
  read: "Pembaca",
  none: "Tidak punya akses",
};

// Badge colours track severity, not identity: `none` is the only state that is
// a problem, so it is the only warm one. Palette is the same slate/blue/amber
// already used across the app.
const ROLE_BADGE: Record<Role, string> = {
  admin: "bg-blue-50 text-blue-700 border-blue-200",
  write: "bg-emerald-50 text-emerald-700 border-emerald-200",
  read: "bg-slate-100 text-slate-600 border-slate-200",
  none: "bg-amber-50 text-amber-700 border-amber-200",
};

const ASSIGNABLE: Role[] = ["read", "write", "admin"];

// What a role actually lets someone do, in consequences rather than in nouns.
// Used by the confirmation dialogs, which have to answer "and then what?" — a
// dialog that only says "peran akan diubah menjadi Penulis" has told the reader
// nothing they did not already see in the dropdown.
const ROLE_EFFECT: Record<Role, string> = {
  read: "Pembaca boleh mengambil data dari cloud dan melihat semuanya, tapi perubahan yang dia buat tidak pernah terkirim — semua editannya berhenti di perangkatnya sendiri.",
  write:
    "Penulis boleh mengambil data dan mengirim perubahan, jadi apa pun yang dia catat masuk ke cloud dan terlihat oleh semua orang.",
  admin:
    "Admin boleh mengambil, mengirim, dan mengatur daftar peran ini — termasuk memberi dan mencabut akses orang lain, Anda sendiri termasuk.",
  none: "Tanpa peran, permintaan dari orang ini ditolak server.",
};

// Rank only exists to tell a promotion from a demotion, so the dialog can wear
// danger styling when abilities are being taken away rather than given.
const ROLE_RANK: Record<Role, number> = { none: 0, read: 1, write: 2, admin: 3 };

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

interface Me {
  email: string;
  role: Role;
}

interface RoleRow {
  email: string;
  role: Role;
  createdAt: string;
  createdBy: string;
}

interface TableStat {
  table: string;
  live: number;
  deleted: number;
}

interface RecentRow {
  table: string;
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  deleted?: boolean;
}

interface AdminStats {
  tables: TableStat[];
  recent: RecentRow[];
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
    res = await fetch(path, { ...init, credentials: "same-origin" });
  } catch {
    throw new ApiFailure(0, "offline", "Tidak bisa menghubungi server.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    if (res.status === 401 || res.status === 403 || res.redirected) {
      throw new ApiFailure(
        401,
        "unauthenticated",
        "Sesi Cloudflare Access sudah berakhir. Muat ulang halaman ini untuk masuk lagi.",
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

// A lapsed Access session is the one error whose fix is not "coba lagi": only a
// full page load lets Access re-issue the session, so that instruction replaces
// whatever the server said, everywhere an error is rendered.
function messageOf(e: unknown): string {
  if (e instanceof ApiFailure && e.code === "unauthenticated") {
    return "Sesi Cloudflare Access sudah berakhir. Muat ulang halaman ini untuk masuk lagi.";
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

function AdminSections({ status }: { status: SyncStatus }) {
  // Whether this Access identity is the owner. Unknown until /api/admin/me
  // answers; 403 means "signed in, just not you" and must still leave sections
  // 1–4 on screen, because a non-owner is entitled to all of those.
  const [owner, setOwner] = useState<boolean | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<Me>("/api/admin/me")
      .then((data) => {
        if (!alive) return;
        setMe(data);
        setOwner(true);
        setAdminError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setOwner(false);
        // 403 is not an error to shout about — it is the normal answer for a
        // reader or writer. Anything else is worth printing.
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
      <SyncStatusPanel status={status} />
      <ActionsPanel status={status} />
      {status.role === "read" && <ScratchPanel />}
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
  const role = me?.role ?? status.role;
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
      {role === "none" && (
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

// ---------- 2. Status sinkron ----------

function SyncStatusPanel({ status }: { status: SyncStatus }) {
  // A reader's pending rows are NOT a queue: they will never be pushed, so
  // calling them "menunggu dikirim" would promise something that never happens.
  // For a reader the same number means local divergence. See sync-plan.md.
  const reader = status.role === "read";
  const pendingLabel = reader ? "Berbeda dari cloud" : "Menunggu dikirim";
  const rows = TABLES.map((t) => ({
    name: t.name,
    count: status.pending[t.name] ?? 0,
  })).filter((r) => r.count > 0);

  return (
    <Panel>
      <h2 className="text-lg font-bold mb-3">Status sinkron</h2>
      <div className="flex gap-6 flex-wrap">
        <Stat
          label="Koneksi"
          value={status.online ? "Online" : "Offline"}
          className={status.online ? "text-emerald-700" : "text-amber-600"}
        />
        <Stat
          label={pendingLabel}
          value={`${formatAngka(status.pendingTotal)} baris`}
          className={status.pendingTotal > 0 ? "text-amber-600" : ""}
        />
        <Stat
          label="Terakhir dikirim"
          value={status.lastPushAt ? formatDateTimeID(status.lastPushAt) : "—"}
        />
        <Stat
          label="Terakhir diambil"
          value={status.lastPullAt ? formatDateTimeID(status.lastPullAt) : "—"}
        />
      </div>

      {status.pendingTotal > 0 && (
        <>
          <p className="mt-4 mb-2 text-sm text-slate-500">
            {reader
              ? "Baris berikut hanya ada di perangkat ini dan berbeda dari cloud. Peran Pembaca tidak pernah mengirim, jadi perubahan ini akan tetap di sini sampai dibuang."
              : "Baris berikut sudah tersimpan di perangkat ini dan menunggu giliran dikirim ke cloud."}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tabel</th>
                  <th className={`${thClass} text-right`}>Baris</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="hover:bg-slate-50">
                    <td className={tdClass}>{tableLabel(r.name)}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(r.count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {status.pendingTotal === 0 && (
        <p className="mt-3 text-sm text-slate-400">
          Semua data di perangkat ini sudah sama dengan cloud.
        </p>
      )}

      {status.error && (
        <p className="mt-3 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          Sinkronisasi terakhir gagal: {status.error}
        </p>
      )}
    </Panel>
  );
}

// ---------- 3. Aksi ----------

type ActionKey = "sync" | "pull" | "discard";

function ActionsPanel({ status }: { status: SyncStatus }) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Which action is waiting for confirmation. One slot, not one flag per
  // button: only ever one dialog is on screen.
  const [confirming, setConfirming] = useState<ActionKey | null>(null);
  // canWrite() is read at render rather than cached: a demotion lands on the
  // next status tick, and the button must disappear with it.
  const writable = canWrite();

  // Every action shares one runner so a thrown error can never leave the page
  // silently unchanged — `busy` comes from the client, not from local state.
  async function run(fn: () => void | Promise<void>, ok: string) {
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(ok);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  // Confirmation is a dialog, never window.confirm(): a native confirm freezes
  // the entire page while it is up — no re-render, no status tick, no way to
  // scroll the warning it is too small to show anyway — which is exactly wrong
  // for a screen whose whole job is reporting live state.
  function confirmed() {
    const key = confirming;
    setConfirming(null);
    if (key === "sync") void run(syncNow, "Sinkronisasi selesai.");
    else if (key === "pull") void run(pullNow, "Data terbaru sudah diambil.");
    else if (key === "discard")
      void run(
        discardLocalChanges,
        "Perubahan lokal dibuang dan data diambil ulang dari cloud.",
      );
  }

  const diverging = status.pendingTotal;

  return (
    <Panel>
      <h2 className="text-lg font-bold mb-1">Aksi</h2>
      <p className="text-sm text-slate-500 mb-3">
        Sinkronisasi berjalan sendiri setiap kali ada perubahan. Tombol di sini
        untuk memaksanya sekarang.
      </p>
      <div className="flex gap-2 flex-wrap items-center">
        {writable && (
          <PrimaryButton
            onClick={() => setConfirming("sync")}
            disabled={status.busy}
          >
            Sinkronkan sekarang
          </PrimaryButton>
        )}
        <Button onClick={() => setConfirming("pull")} disabled={status.busy}>
          Ambil dari cloud
        </Button>
        <DangerButton
          onClick={() => setConfirming("discard")}
          disabled={status.busy}
        >
          Buang perubahan lokal
        </DangerButton>
        {status.busy && (
          <span className="text-sm text-slate-400">Sedang berjalan…</span>
        )}
      </div>

      {confirming === "sync" && (
        <ConfirmDialog
          title="Sinkronkan sekarang?"
          confirmLabel="Ya, sinkronkan"
          onConfirm={confirmed}
          onClose={() => setConfirming(null)}
        >
          <p>
            Perubahan yang tersimpan di perangkat ini dikirim ke cloud, lalu
            data terbaru dari cloud diambil ke perangkat ini. Ini persis
            sinkronisasi yang biasanya jalan sendiri — tombolnya hanya
            mempercepat.
          </p>
          <p>
            Tidak ada yang dihapus, dan baris yang Anda ubah di sini tidak
            ditimpa oleh versi cloud.
          </p>
        </ConfirmDialog>
      )}

      {confirming === "pull" && (
        <ConfirmDialog
          title="Ambil data dari cloud?"
          confirmLabel="Ya, ambil"
          onConfirm={confirmed}
          onClose={() => setConfirming(null)}
        >
          <p>
            Data terbaru dari cloud dimasukkan ke perangkat ini, jadi tampilan
            di layar akan menyusul isi cloud.
          </p>
          <p>
            Baris yang Anda ubah di perangkat ini dan belum ada di cloud{" "}
            <strong>tidak ditimpa</strong> — perubahan itu tetap utuh. Tidak ada
            yang dihapus, dan tidak ada apa pun yang dikirim ke cloud.
          </p>
        </ConfirmDialog>
      )}

      {confirming === "discard" && (
        <ConfirmDialog
          danger
          title="Buang semua perubahan lokal?"
          confirmLabel="Ya, buang perubahan lokal"
          onConfirm={confirmed}
          onClose={() => setConfirming(null)}
        >
          <p className="font-semibold text-red-700">
            {diverging > 0
              ? `${formatAngka(diverging)} baris yang hanya ada di perangkat ini dan belum tersimpan di cloud akan dihapus.`
              : "Semua baris yang hanya ada di perangkat ini dan belum tersimpan di cloud akan dihapus."}
          </p>
          <p>
            Setelah itu seluruh data diambil ulang dari cloud, jadi isi
            perangkat ini akan sama persis dengan isi cloud. Termasuk hasil
            “Mode coba-coba”, kalau pernah dipakai.
          </p>
          <p className="font-semibold">
            Tidak bisa dibatalkan. Tidak ada salinan yang disimpan lebih dulu —
            kalau masih ragu, batalkan dan tekan “Backup semua” di bawah menu
            kiri.
          </p>
          <p>
            Yang sudah tersimpan di cloud aman: tindakan ini tidak menghapus apa
            pun di sana, dan tidak menyentuh perangkat orang lain.
          </p>
        </ConfirmDialog>
      )}

      {!writable && (
        <p className="mt-3 text-sm text-slate-500">
          Peran Anda tidak boleh mengirim data, jadi hanya pengambilan dari
          cloud yang tersedia.
        </p>
      )}

      {note && (
        <p className="mt-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {note}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </Panel>
  );
}

// ---------- 4. Mode coba-coba ----------

function ScratchPanel() {
  // Not derived from a prop: setScratchMode is a plain setter with no
  // subscription behind it, so the checkbox owns the rendered value and reads
  // the stored one exactly once, at mount.
  const [on, setOn] = useState(() => isScratchMode());

  function toggle(next: boolean) {
    setScratchMode(next);
    setOn(next);
  }

  return (
    <Panel>
      <h2 className="text-lg font-bold mb-1">Mode coba-coba</h2>
      <p className="text-sm text-slate-500 mb-3">
        Peran Pembaca tidak bisa mengubah data. Mode ini membuka kunci
        pengeditan di perangkat ini saja — untuk mencoba-coba, bukan untuk
        mencatat sungguhan.
      </p>
      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          className="align-middle accent-blue-600"
          checked={on}
          onChange={(e) => toggle(e.target.checked)}
        />
        Izinkan pengeditan lokal
      </label>
      <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        Yang Anda ubah dalam mode ini tersimpan di perangkat ini saja, tidak
        pernah dikirim ke cloud, dan akan hilang saat data berikutnya diambil
        dari cloud. Jangan pakai mode ini untuk mencatat pesanan sungguhan.
      </p>
    </Panel>
  );
}

// ---------- 5. Peran ----------

// The pending confirmation, carrying everything the dialog needs to describe
// what is about to happen. Held as one value rather than three booleans so the
// copy can name the exact email and the exact before/after role.
type RoleAction =
  | { kind: "add"; email: string; role: Role }
  | { kind: "change"; row: RoleRow; next: Role }
  | { kind: "remove"; row: RoleRow };

function RolesPanel() {
  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("read");
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

  function put(address: string, next: Role) {
    return apiFetch("/api/admin/roles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: address, role: next }),
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
        await put(action.email, action.role);
        setEmail("");
      });
    } else if (action.kind === "change") {
      void mutate(() => put(action.row.email, action.next));
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
    setPending({ kind: "add", email: address, role });
  }

  function askChange(row: RoleRow, next: Role) {
    if (next === row.role) return;
    setPending({ kind: "change", row, next });
  }

  return (
    <Panel>
      <h2 className="text-lg font-bold mb-1">Peran</h2>
      <p className="text-sm text-slate-500 mb-3">
        Siapa saja yang boleh mengakses data di cloud. Pembaca hanya bisa
        mengambil, Penulis bisa mengirim, Admin juga bisa mengatur daftar ini.
      </p>

      <div className="flex gap-3 flex-wrap items-end mb-3">
        <Field label="Email" className="flex-1 min-w-[220px]">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@contoh.com"
          />
        </Field>
        <Field label="Peran" className="w-40">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ASSIGNABLE.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <PrimaryButton onClick={askAdd} disabled={busy || email.trim() === ""}>
          + Tambah / Ubah
        </PrimaryButton>
      </div>

      {rows === null && !error ? (
        <p className="text-sm text-slate-400 py-4 text-center">Memuat…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thClass}>Email</th>
                <th className={thClass}>Peran</th>
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
                    <Select
                      className="w-36"
                      value={r.role}
                      disabled={busy}
                      onChange={(e) => askChange(r, e.target.value as Role)}
                    >
                      {ASSIGNABLE.map((opt) => (
                        <option key={opt} value={opt}>
                          {ROLE_LABEL[opt]}
                        </option>
                      ))}
                    </Select>
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
          <p>
            Kalau email itu sudah ada di daftar, peran lamanya diganti dengan
            yang ini. Berlaku langsung, dan bisa diubah atau dicabut kapan saja.
          </p>
        </ConfirmDialog>
      )}

      {pending?.kind === "change" && (
        <ConfirmDialog
          // Taking abilities away deserves the red treatment; handing them out
          // does not.
          danger={ROLE_RANK[pending.next] < ROLE_RANK[pending.row.role]}
          title="Ubah peran orang ini?"
          confirmLabel="Ya, ubah peran"
          busy={busy}
          onConfirm={confirmed}
          onClose={() => setPending(null)}
        >
          <p>
            <strong>{pending.row.email}</strong> berubah dari{" "}
            <strong>{ROLE_LABEL[pending.row.role]}</strong> menjadi{" "}
            <strong>{ROLE_LABEL[pending.next]}</strong>.
          </p>
          <p>{ROLE_EFFECT[pending.next]}</p>
          <p>
            Berlaku seketika — server memeriksa ulang peran setiap kali ada
            pengiriman data, jadi orangnya tidak perlu masuk ulang. Data yang
            sudah pernah dia kirim tetap ada dan tidak berubah.
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

// ---------- 6. Aktivitas ----------

function ActivityPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <div className="overflow-x-auto mb-4">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tabel</th>
                  <th className={`${thClass} text-right`}>Baris aktif</th>
                  <th className={`${thClass} text-right`}>Terhapus</th>
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
