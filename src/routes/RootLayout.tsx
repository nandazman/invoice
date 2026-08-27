import { useMemo, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { exportAll, importAll } from "../lib/backup";
import { flushWrites } from "../lib/db";
import { downloadJSON, pickJSONFile } from "../lib/io";
import {
  useSyncStatus,
  isBlocked,
  discardLocalChanges,
  replaceCloudWithLocal,
  canPushToCloud,
} from "../lib/sync/client";
import { formatAngka } from "../lib/format";
import { PrimaryButton } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GateScreen } from "../components/GateScreen";
import { Modal } from "../components/Modal";
import { SyncChip } from "../components/SyncChip";

const COLLAPSE_KEY = "invoice.sidebar.collapsed";
const GROUPS_KEY = "invoice.sidebar.groups";

// The label for the whole-dataset actions group at the end of the nav. A
// constant rather than a literal because it is BOTH the heading and the key
// inside `closedGroups`, and the two silently drifting apart would leave a
// header whose arrow never matched what it was hiding.
const BACKUP_GROUP = "Cadangan";

const linkBase =
  "flex items-center gap-2.5 px-3 py-2.5 rounded-lg font-semibold text-slate-500 hover:bg-slate-100 transition-colors";
const linkActive = "bg-blue-50 text-blue-600 hover:bg-blue-50";

// Sidebar navigation, grouped. Each group's item list is collapsible.
interface NavItem {
  to: string;
  label: string;
  icon: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Data",
    items: [
      { to: "/harga", label: "Harga", icon: "🏷️" },
      { to: "/pesanan", label: "Pesanan", icon: "📦" },
      { to: "/pembeli", label: "Pembeli", icon: "👥" },
      { to: "/stok", label: "Stok", icon: "🏬" },
      { to: "/beli-stok", label: "Beli Stock", icon: "🛒" },
      { to: "/riwayat", label: "Riwayat", icon: "🕓" },
    ],
  },
  {
    label: "Alat",
    items: [
      { to: "/excel", label: "Ekspor Excel", icon: "📊" },
      { to: "/template", label: "Desain Template", icon: "🎨" },
      { to: "/invoice", label: "Buat Invoice", icon: "🧾" },
    ],
  },
  {
    label: "Laporan",
    items: [{ to: "/laporan", label: "Laba Rugi", icon: "📈" }],
  },
];

// Admin-only nav. Its own group, not Alat: this is about the app itself — who
// has access and what the cloud database looks like — rather than anything you
// do to the data.
//
// Everything a non-admin used to open /admin for now lives in the sync chip at
// the bottom of this sidebar, so the page behind this entry is genuinely
// admin-only: roles and the D1 dashboard, nothing else.
const SYSTEM_GROUP: NavGroup = {
  label: "Sistem",
  items: [{ to: "/admin", label: "Pengaturan", icon: "⚙️" }],
};

export function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The role arrives asynchronously: the app boots offline-first and
  // /api/sync/me answers later, starting at "none". Testing for "admin"
  // positively — rather than hiding on a known-non-admin — is what keeps the
  // entry from flashing in during boot and disappearing again. Unreachable API
  // means the role is unknown, which is also not admin, so it stays hidden.
  const status = useSyncStatus();
  const groups = useMemo(
    () =>
      status.role === "admin" ? [...NAV_GROUPS, SYSTEM_GROUP] : NAV_GROUPS,
    [status.role],
  );
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );
  // Per-group collapse state: a set of group labels whose item list is hidden.
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(GROUPS_KEY);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  function toggleGroup(label: string) {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  // Restore is the one action that can wipe everything, so it gets three pieces
  // of state: the confirmation, the in-flight flag that keeps it from firing
  // twice, and the outcome — which has to be reported somewhere now that
  // alert() is gone.
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // `note` carries the second paragraph a failure needs: what state the data is
  // actually in now. It is written by the caller rather than derived here
  // because it is a claim about the user's data, and only the action that
  // failed knows how far it got — "nothing was replaced" is reassurance when it
  // is true and a lie when it is not.
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    note?: string;
  } | null>(null);

  // "Ambil dari cloud": the same discard the sync panel offers under Lanjutan,
  // promoted into the nav because the moment you need it is the moment this
  // device's copy is wrong — and someone whose copy is wrong does not go
  // looking inside a status panel for the cure.
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // The opposite direction to the reset above: this device is right and the
  // CLOUD is wrong. Its blast radius is the opposite one too — the reset
  // touches nobody else, this reaches every other device — which is why it
  // carries its own confirmation rather than sharing one.
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function doPublish() {
    setPublishing(true);
    try {
      const removed = await replaceCloudWithLocal();
      setResult({
        ok: true,
        message:
          removed > 0
            ? `Cloud sudah disamakan dengan perangkat ini. ${formatAngka(removed)} baris yang hanya ada di cloud ditandai terhapus, dan akan hilang juga di perangkat lain begitu mereka menyinkron.`
            : "Cloud sudah disamakan dengan perangkat ini.",
      });
    } catch (e) {
      setResult({
        ok: false,
        message: "Gagal mengirim ke cloud: " + (e as Error).message,
        // Deliberately not "nothing happened". The tombstones are written
        // locally before the push, so a failure here can leave this device a
        // step ahead of the cloud — which the next ordinary sync will finish.
        note:
          "Sebagian perubahan mungkin sudah terkirim. Coba lagi setelah koneksi " +
          "membaik; kalau justru cloud yang ingin Anda ikuti, pakai “Ambil ulang " +
          "dari cloud”.",
      });
    } finally {
      setPublishing(false);
      setConfirmingPublish(false);
    }
  }

  async function doReset() {
    setResetting(true);
    try {
      await discardLocalChanges();
      setResult({
        ok: true,
        message: "Data di perangkat ini sudah disamakan dengan cloud.",
      });
    } catch (e) {
      setResult({
        ok: false,
        message: "Gagal mengambil ulang: " + (e as Error).message,
        // Nothing was replaced: `discardLocalChanges` only writes after the pull
        // has answered, so a failure leaves this device exactly as it was.
        note: "Data di perangkat ini belum diganti dan masih utuh.",
      });
    } finally {
      setResetting(false);
      setConfirmingReset(false);
    }
  }

  function doBackup() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJSON(`invoice-backup-${stamp}.json`, exportAll());
  }

  // Runs with the confirmation still on screen and `busy`, so both its buttons
  // are dead until the restore finishes — a second click cannot start a second
  // import over the first one's half-written stores. Escape and the backdrop
  // still close it, which is the way out if the file picker is dismissed
  // instead of used (that leaves pickJSONFile's promise pending forever).
  async function doRestore() {
    setRestoring(true);
    // Flips the moment the stores have actually been replaced. Everything up to
    // and including importAll validates before it writes, so a failure there
    // leaves the old data whole — after it, that is no longer true, and
    // flushWrites can still throw.
    let replaced = false;
    try {
      const text = await pickJSONFile();
      importAll(text);
      replaced = true;
      // Every store writes to IndexedDB fire-and-forget, so the restore is NOT
      // durable when importAll returns — only the in-memory arrays are. Wait
      // for the writes to land before reporting success, or a tab closed right
      // after "berhasil" would lose the whole restore.
      //
      // This used to end in location.reload(), which was safe when stores wrote
      // synchronously to localStorage but now kills the in-flight transactions
      // outright. No reload is needed: every store is reactive, so the UI has
      // already updated.
      await flushWrites();
      setResult({ ok: true, message: "Data berhasil dipulihkan." });
    } catch (e) {
      setResult({
        ok: false,
        message: "Gagal memulihkan: " + (e as Error).message,
        note: replaced
          ? // The bad case: the stores are already the backup's, but the write
            // to IndexedDB did not confirm. Reloading is how the user finds out
            // which of the two they actually have.
            "Data sudah diganti sebelum kesalahan ini terjadi, tetapi belum tentu " +
            "tersimpan. Muat ulang halaman untuk memeriksa, lalu pulihkan sekali " +
            "lagi bila perlu."
          : // importAll validates the whole file before it touches any store, so
            // a berkas that fails there never lands halfway.
            "Berkas cadangan diperiksa sebelum data lama diganti, jadi data di " +
            "perangkat ini masih utuh.",
      });
    } finally {
      setRestoring(false);
      setConfirmingRestore(false);
    }
  }

  // The gate. Below every hook on purpose — an early return above them would
  // change the hook count between renders the moment /api/sync/me answers.
  //
  // The condition is entirely inside `isBlocked` (client.ts), which is where
  // the reasoning about its three terms lives. In particular this must NOT
  // become `status.role === "none"`: that blanks the GitHub Pages copy, which
  // has no API to ask and therefore no role.
  if (isBlocked(status)) return <GateScreen email={status.email} />;

  return (
    <div className="flex min-h-screen">
      <aside
        className={`${
          collapsed ? "w-16" : "w-56"
        } shrink-0 bg-white border-r border-slate-200 p-3 flex flex-col sticky top-0 h-screen transition-[width] duration-200`}
      >
        <div className="shrink-0 flex items-center justify-between mb-4">
          {!collapsed && (
            <span className="font-bold text-lg px-2">🧾 Invoice</span>
          )}
          <button
            onClick={toggle}
            title={collapsed ? "Buka sidebar" : "Tutup sidebar"}
            aria-label="Toggle sidebar"
            className="ml-auto p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        {/* The one part of the sidebar that may grow past the viewport, so it
            is the one part that scrolls. `min-h-0` is load-bearing: a flex item
            defaults to `min-height: auto`, which refuses to shrink below its
            content and would push the backup buttons off a short screen instead
            of scrolling — exactly the bug this fixes. The bar is hidden because
            the column is 56px wide (16px collapsed) and a gutter there is more
            intrusive than the scrollbar is useful. */}
        <nav className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto no-scrollbar">
          {groups.map((group, gi) => {
            const groupClosed = closedGroups.has(group.label);
            // Highlight the group header when one of its pages is the active route.
            const groupActive = group.items.some(
              (item) =>
                pathname === item.to || pathname.startsWith(item.to + "/"),
            );
            return (
              <div key={group.label} className="flex flex-col gap-1">
                {collapsed ? (
                  // Icon-only mode: a thin divider separates groups; items always show.
                  gi > 0 && <div className="my-2 border-t border-slate-200" />
                ) : (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={!groupClosed}
                    className={`flex items-center gap-1 px-2.5 text-xs uppercase tracking-wide cursor-pointer ${
                      gi > 0 ? "pt-3 pb-1" : "pt-1 pb-1"
                    } ${
                      groupActive
                        ? "text-blue-600 font-semibold"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    <span className="text-[10px] w-3 inline-block">
                      {groupClosed ? "▸" : "▾"}
                    </span>
                    {group.label}
                  </button>
                )}
                {(collapsed || !groupClosed) &&
                  group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      title={item.label}
                      className={`${linkBase} ${
                        collapsed ? "justify-center px-0" : ""
                      }`}
                      activeProps={{
                        className: `${linkBase} ${linkActive} ${
                          collapsed ? "justify-center px-0" : ""
                        }`,
                      }}
                    >
                      <span className="text-base">{item.icon}</span>
                      {!collapsed && item.label}
                    </Link>
                  ))}
              </div>
            );
          })}

          {/* The last group, and the reason it is written out here rather than
              added to NAV_GROUPS: every group above is a list of DESTINATIONS,
              rendered as <Link>. These four are actions on the whole dataset —
              they open a dialog, they do not navigate — so they share the
              groups' markup and their collapse state but not their data shape.

              It lives inside <nav> so it scrolls and folds exactly like the
              others; only the sync chip stays pinned below. */}
          <div className="flex flex-col gap-1">
            {collapsed ? (
              <div className="my-2 border-t border-slate-200" />
            ) : (
              <button
                onClick={() => toggleGroup(BACKUP_GROUP)}
                aria-expanded={!closedGroups.has(BACKUP_GROUP)}
                className="flex items-center gap-1 px-2.5 pt-3 pb-1 text-xs uppercase tracking-wide text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <span className="text-[10px] w-3 inline-block">
                  {closedGroups.has(BACKUP_GROUP) ? "▸" : "▾"}
                </span>
                {BACKUP_GROUP}
              </button>
            )}
            {(collapsed || !closedGroups.has(BACKUP_GROUP)) && (
              <>
                {/* Hidden entirely where there is no cloud to take data from — the
              GitHub Pages copy, which has no Worker behind it. A button that
              offered to replace everything with nothing would be the single
              most destructive control in the app. */}
                {status.available && (
                  <button
                    onClick={() => setConfirmingReset(true)}
                    title="Ambil ulang semua data dari cloud"
                    className={`${linkBase} ${collapsed ? "justify-center px-0" : ""} cursor-pointer`}
                  >
                    <span className="text-base">☁️</span>
                    {!collapsed && "Ambil dari cloud"}
                  </button>
                )}
                {/* The opposite direction, and its own button rather than a link
              buried in the dialog above. Both are answers to "these two copies
              disagree", but a control you cannot find is a control that does
              not exist — and this is the one people reach for after a restore
              from a backup file, which is the moment the cloud is the copy that
              is wrong.

              Two conditions, not one: `available` because there must be a cloud
              to overwrite, and `canPushToCloud` because a local-only account
              would only ever get a 403 from it. */}
                {status.available && canPushToCloud() && (
                  <button
                    onClick={() => setConfirmingPublish(true)}
                    title="Ganti isi cloud dengan data di perangkat ini"
                    className={`${linkBase} ${collapsed ? "justify-center px-0" : ""} cursor-pointer`}
                  >
                    <span className="text-base">⬆️</span>
                    {!collapsed && "Kirim ke cloud"}
                  </button>
                )}
                <button
                  onClick={doBackup}
                  title="Backup semua data"
                  className={`${linkBase} ${collapsed ? "justify-center px-0" : ""} cursor-pointer`}
                >
                  <span className="text-base">💾</span>
                  {!collapsed && "Backup semua"}
                </button>
                <button
                  onClick={() => setConfirmingRestore(true)}
                  title="Pulihkan dari cadangan"
                  className={`${linkBase} ${collapsed ? "justify-center px-0" : ""} cursor-pointer`}
                >
                  <span className="text-base">♻️</span>
                  {!collapsed && "Pulihkan"}
                </button>
              </>
            )}
          </div>
        </nav>

        {/* Pinned below the scroll area on purpose, and now the only thing that
            is. The chip REPORTS rather than offers, and a status you have to
            scroll to — or expand a section to reach — is a status nobody reads,
            which is the whole reason it is a chip and not a nav link. */}
        <div className="shrink-0 pt-3 flex flex-col gap-1">
          <SyncChip collapsed={collapsed} />
          {!collapsed && (
            <div className="px-2.5 pt-2 text-xs text-slate-400">
              Tersimpan lokal di browser
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="max-w-5xl mx-auto p-6">
          <Outlet />
        </div>
      </main>

      {confirmingReset && (
        <ConfirmDialog
          danger
          title="Ambil ulang semua data dari cloud?"
          confirmLabel={
            resetting ? "Sedang mengambil…" : "Ya, samakan dengan cloud"
          }
          busy={resetting}
          onConfirm={doReset}
          onClose={() => setConfirmingReset(false)}
        >
          <p className="font-semibold text-red-700">
            {status.pendingTotal > 0
              ? `${formatAngka(status.pendingTotal)} baris yang hanya ada di perangkat ini dan belum tersimpan di cloud akan dihapus.`
              : "Semua baris yang hanya ada di perangkat ini dan belum tersimpan di cloud akan dihapus."}
          </p>
          <p>
            Seluruh data diambil ulang dari cloud, jadi isi perangkat ini akan
            sama persis dengan isi cloud — termasuk baris ganda atau salah yang
            hanya muncul di sini.
          </p>
          <p className="font-semibold">
            Tidak bisa dibatalkan, dan tidak ada salinan yang disimpan lebih
            dulu. Kalau masih ragu, batalkan dan tekan “Backup semua” tepat di
            bawah tombol ini.
          </p>
          <p>
            Yang sudah tersimpan di cloud aman: tindakan ini tidak menghapus apa
            pun di sana, dan tidak menyentuh perangkat orang lain.
          </p>
        </ConfirmDialog>
      )}

      {confirmingPublish && (
        <ConfirmDialog
          danger
          title="Ganti isi cloud dengan data perangkat ini?"
          confirmLabel={publishing ? "Sedang mengirim…" : "Ya, ganti isi cloud"}
          busy={publishing}
          onConfirm={() => void doPublish()}
          onClose={() => setConfirmingPublish(false)}
        >
          <p className="font-semibold text-red-700">
            Ini mengubah data SEMUA orang, bukan cuma perangkat ini.
          </p>
          <p>
            Seluruh isi perangkat ini dikirim ke cloud, dan baris yang ada di
            cloud tetapi tidak ada di sini ditandai terhapus — termasuk baris
            ganda yang ingin Anda bersihkan. Perangkat lain ikut kehilangan
            baris itu begitu mereka menyinkron.
          </p>
          <p>
            Riwayat perubahan tidak ikut dihapus: catatan riwayat hanya
            ditambah, tidak pernah dicabut.
          </p>
          <p className="font-semibold">
            Tidak bisa dibatalkan. Lakukan ini hanya kalau Anda yakin perangkat
            inilah yang datanya benar. Kalau masih ragu, batalkan dan tekan
            “Backup semua” lebih dulu.
          </p>
          {publishing && <p>Sedang mengirim — jangan tutup tab ini…</p>}
        </ConfirmDialog>
      )}

      {confirmingRestore && (
        <ConfirmDialog
          danger
          title="Pulihkan dari cadangan?"
          confirmLabel="Ya, pulihkan"
          busy={restoring}
          onConfirm={() => void doRestore()}
          onClose={() => setConfirmingRestore(false)}
        >
          <p className="font-semibold text-red-700">
            SEMUA data di perangkat ini — produk, pesanan, stok, tipe, template,
            dan riwayat — diganti oleh isi berkas cadangan.
          </p>
          <p>
            Setelah menekan tombol di bawah, Anda memilih berkas cadangannya
            dulu; penggantian baru berjalan sesudah berkas itu terbaca.
          </p>
          <p className="font-semibold">
            Tidak bisa dibatalkan. Kalau masih ragu, batalkan dan tekan “Backup
            semua” lebih dulu agar data sekarang punya salinan.
          </p>
          {restoring && <p>Sedang memulihkan — jangan tutup tab ini…</p>}
        </ConfirmDialog>
      )}

      {/* The outcome, not a question — so it is a plain Modal, not a
          ConfirmDialog. It has to be a modal rather than a line in the sidebar
          because the sidebar collapses to 4rem wide, where the message would
          have nowhere to go. */}
      {result && (
        <Modal onClose={() => setResult(null)}>
          <h2
            className={`text-lg font-bold mb-2 ${
              result.ok ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {result.ok ? "Selesai" : "Gagal"}
          </h2>
          <p className="text-sm text-slate-600 mb-5">{result.message}</p>
          {result.note && (
            <p className="text-sm text-slate-600 mb-5">{result.note}</p>
          )}
          <div className="flex justify-end">
            <PrimaryButton autoFocus onClick={() => setResult(null)}>
              Tutup
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
