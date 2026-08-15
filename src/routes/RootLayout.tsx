import { useMemo, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { exportAll, importAll } from "../lib/backup";
import { flushWrites } from "../lib/db";
import { downloadJSON, pickJSONFile } from "../lib/io";
import { useSyncStatus, isBlocked } from "../lib/sync/client";
import { PrimaryButton } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GateScreen } from "../components/GateScreen";
import { Modal } from "../components/Modal";
import { SyncChip } from "../components/SyncChip";

const COLLAPSE_KEY = "invoice.sidebar.collapsed";
const GROUPS_KEY = "invoice.sidebar.groups";

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
    () => (status.role === "admin" ? [...NAV_GROUPS, SYSTEM_GROUP] : NAV_GROUPS),
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
  // `intact` is not cosmetic: the reassurance shown on failure is a claim about
  // the user's data, and it is only true while nothing has been replaced yet.
  const [result, setResult] = useState<
    { ok: boolean; message: string; intact?: boolean } | null
  >(null);

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
        intact: !replaced,
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
        <div className="flex items-center justify-between mb-4">
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

        <nav className="flex flex-col gap-1">
          {groups.map((group, gi) => {
            const groupClosed = closedGroups.has(group.label);
            // Highlight the group header when one of its pages is the active route.
            const groupActive = group.items.some(
              (item) => pathname === item.to || pathname.startsWith(item.to + "/"),
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
        </nav>

        <div className="mt-auto pt-3 flex flex-col gap-1">
          {/* Above the backup buttons, and rendering nothing at all on the
              copy with no API behind it. A chip rather than a nav link because
              it has to report state, not just offer a destination. */}
          <SyncChip collapsed={collapsed} />
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
            {result.ok ? "Pemulihan selesai" : "Pemulihan gagal"}
          </h2>
          <p className="text-sm text-slate-600 mb-5">{result.message}</p>
          {!result.ok && result.intact && (
            // Only when nothing was replaced. importAll validates the whole
            // file before it touches any store, so a berkas that fails there
            // never lands halfway — but a failure AFTER it did land must not be
            // dressed up as one that did not.
            <p className="text-sm text-slate-600 mb-5">
              Berkas cadangan diperiksa sebelum data lama diganti, jadi data di
              perangkat ini masih utuh.
            </p>
          )}
          {!result.ok && !result.intact && (
            // The bad case: the stores are already the backup's, but the write
            // to IndexedDB did not confirm. Reloading is how the user finds out
            // which of the two they actually have.
            <p className="text-sm text-slate-600 mb-5">
              Data sudah diganti sebelum kesalahan ini terjadi, tetapi belum
              tentu tersimpan. Muat ulang halaman untuk memeriksa, lalu pulihkan
              sekali lagi bila perlu.
            </p>
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
