import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
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
import { describeUnsynced, stalenessDays } from "../lib/rescue";
import { useMediaQuery } from "../lib/useMediaQuery";
import { PrimaryButton } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GateScreen } from "../components/GateScreen";
import { Modal, useEscapeToClose, useScrollLock } from "../components/Modal";
import { SyncChip } from "../components/SyncChip";
import {
  ArrowUpIcon,
  BoxIcon,
  CartIcon,
  ChartIcon,
  ChevronDownIcon,
  ClockIcon,
  CloudIcon,
  DownloadIcon,
  FileTextIcon,
  GearIcon,
  MoreIcon,
  PenToolIcon,
  RefreshIcon,
  SheetIcon,
  StoreIcon,
  TagIcon,
  UsersIcon,
} from "../components/icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const COLLAPSE_KEY = "invoice.sidebar.collapsed";
const GROUPS_KEY = "invoice.sidebar.groups";

// The label for the whole-dataset actions group at the end of the nav. A
// constant rather than a literal because it is BOTH the heading and the key
// inside `closedGroups`, and the two silently drifting apart would leave a
// header whose arrow never matched what it was hiding.
const BACKUP_GROUP = "Cadangan";

// The desktop sidebar's row. It is pointer-driven now: below `md` navigation is
// the bottom tab bar and the "Lainnya" sheet, which carry their own touch sizes.
const linkBase =
  "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm font-semibold text-muted hover:bg-surface-hover transition-colors";
const linkActive = "bg-brand-soft text-brand hover:bg-brand-soft";

// Sidebar navigation, grouped. Each group's item list is collapsible.
interface NavItem {
  to: string;
  label: string;
  Icon: IconType;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Data",
    items: [
      { to: "/harga", label: "Harga", Icon: TagIcon },
      { to: "/pesanan", label: "Pesanan", Icon: BoxIcon },
      { to: "/pembeli", label: "Pembeli", Icon: UsersIcon },
      { to: "/stok", label: "Stok", Icon: StoreIcon },
      { to: "/beli-stok", label: "Beli Stock", Icon: CartIcon },
      { to: "/riwayat", label: "Riwayat", Icon: ClockIcon },
    ],
  },
  {
    label: "Alat",
    items: [
      { to: "/excel", label: "Ekspor Excel", Icon: SheetIcon },
      { to: "/template", label: "Desain Template", Icon: PenToolIcon },
      { to: "/invoice", label: "Buat Invoice", Icon: FileTextIcon },
    ],
  },
  {
    label: "Laporan",
    items: [{ to: "/laporan", label: "Laba Rugi", Icon: ChartIcon }],
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
  items: [{ to: "/admin", label: "Pengaturan", Icon: GearIcon }],
};

// The phone's bottom tab bar: the four pages used all day. Everything else is in
// the "Lainnya" sheet, which lists the same groups the desktop sidebar does, so
// no page is reachable on a phone that is not reachable on a desktop and the
// other way round. Same routes, a different control.
const TAB_ITEMS: NavItem[] = [
  { to: "/harga", label: "Harga", Icon: TagIcon },
  { to: "/pesanan", label: "Pesanan", Icon: BoxIcon },
  { to: "/stok", label: "Stok", Icon: StoreIcon },
  { to: "/laporan", label: "Laporan", Icon: ChartIcon },
];
const TAB_PATHS = new Set(TAB_ITEMS.map((t) => t.to));

// Tab-bar height, plus the home-indicator inset on notched phones. One string so
// the bar and the padding that keeps content clear of it cannot drift apart.
const TAB_BAR_H = "calc(3.75rem + env(safe-area-inset-bottom))";

function isActivePath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + "/");
}

// What the phone app bar calls the current page. A detail route has no nav item
// of its own, so it borrows its parent's name rather than a generic one.
function pageTitle(pathname: string, groups: NavGroup[]): string {
  if (pathname.startsWith("/produk")) return "Harga";
  for (const item of [...TAB_ITEMS, ...groups.flatMap((g) => g.items)]) {
    if (isActivePath(pathname, item.to)) return item.label;
  }
  return "Invoice";
}

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
  // The phone's "Lainnya" sheet. Deliberately NOT persisted like `collapsed`
  // is: a sheet that is still open when you come back is a sheet covering the
  // page you asked for.
  const [sheetOpen, setSheetOpen] = useState(false);
  const desktop = useMediaQuery("(min-width: 768px)");
  // Icon-only is a desktop-sidebar mode; the phone has no sidebar to narrow.
  const iconOnly = desktop && collapsed;
  const moreRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEscapeToClose(() => setSheetOpen(false), sheetOpen);
  useScrollLock(sheetOpen);

  // Close on navigation. Without this the sheet stays over the page it just
  // sent you to, which reads as a broken tap.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  // Crossing into desktop with the sheet open would otherwise leave the
  // backdrop and the scroll lock behind, since both are mobile-only.
  useEffect(() => {
    if (desktop) setSheetOpen(false);
  }, [desktop]);

  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus into the sheet so the keyboard follows the eye: its first link,
    // not the scrim or the tab bar underneath.
    const first =
      sheetRef.current?.querySelector<HTMLElement>("a[href]") ??
      sheetRef.current?.querySelector<HTMLElement>("button");
    first?.focus();
    return () => {
      document.body.style.overflow = previous;
      // Back to the control that opened it, not to the top of the document.
      moreRef.current?.focus();
    };
  }, [sheetOpen]);
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
      const rescued = await discardLocalChanges();
      setResult({
        ok: true,
        message: "Data di perangkat ini sudah disamakan dengan cloud.",
        note:
          rescued.total > 0
            ? `${formatAngka(rescued.total)} baris yang belum tersimpan di cloud (${describeUnsynced(rescued)}) diunduh lebih dulu sebagai berkas invoice-unsynced-…json. Simpan berkas itu — isinya satu-satunya salinan yang tersisa.`
            : undefined,
      });
    } catch (e) {
      setResult({
        ok: false,
        message: "Gagal mengambil ulang: " + (e as Error).message,
        // Nothing was replaced. Two reasons now, and both leave the device
        // whole: the rescue runs first and aborts the discard if it fails, and
        // `discardLocalChanges` only writes after the pull has answered.
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
      await importAll(text);
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
          : // importAll validates the whole file AND writes the unsynced-row
            // rescue before it touches any store, so a failure at either step
            // leaves the old data whole.
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

  // The four whole-dataset actions. Data, not markup, because the desktop
  // sidebar and the phone's "Lainnya" sheet both list them and must never
  // disagree about which exist.
  const dataActions: {
    key: string;
    Icon: IconType;
    label: string;
    title: string;
    show: boolean;
    onClick: () => void;
  }[] = [
    {
      // Hidden entirely where there is no cloud to take data from — the GitHub
      // Pages copy, which has no Worker behind it. A button that offered to
      // replace everything with nothing would be the single most destructive
      // control in the app.
      key: "reset",
      Icon: CloudIcon,
      label: "Ambil dari cloud",
      title: "Ambil ulang semua data dari cloud",
      show: status.available,
      onClick: () => setConfirmingReset(true),
    },
    {
      // The opposite direction, and its own button rather than a link buried in
      // the dialog above. Both are answers to "these two copies disagree", but
      // a control you cannot find is a control that does not exist — and this
      // is the one people reach for after a restore from a backup file, which
      // is the moment the cloud is the copy that is wrong.
      //
      // Two conditions, not one: `available` because there must be a cloud to
      // overwrite, and `canPushToCloud` because a local-only account would only
      // ever get a 403 from it.
      key: "publish",
      Icon: ArrowUpIcon,
      label: "Kirim ke cloud",
      title: "Ganti isi cloud dengan data di perangkat ini",
      show: status.available && canPushToCloud(),
      onClick: () => setConfirmingPublish(true),
    },
    {
      key: "backup",
      Icon: DownloadIcon,
      label: "Backup semua",
      title: "Backup semua data",
      show: true,
      onClick: doBackup,
    },
    {
      key: "restore",
      Icon: RefreshIcon,
      label: "Pulihkan",
      title: "Pulihkan dari cadangan",
      show: true,
      onClick: () => setConfirmingRestore(true),
    },
  ];

  // What the "Lainnya" sheet lists: every nav group minus the four pages that
  // already have a tab, so nothing appears twice and nothing is missing.
  const sheetGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !TAB_PATHS.has(i.to)) }))
    .filter((g) => g.items.length > 0);
  const moreActive =
    sheetOpen ||
    sheetGroups.some((g) => g.items.some((i) => isActivePath(pathname, i.to)));

  const tabBase =
    "group flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-faint";
  const tabPill =
    "flex items-center justify-center h-7 w-14 rounded-full transition-colors";

  return (
    <div className="flex min-h-screen">
      {/* The phone app bar: where you are, and the sync state. The chip rides
          here rather than in the sheet: sync state is the one thing that must
          never cost a tap to see. */}
      <header className="md:hidden fixed top-0 inset-x-0 z-20 h-14 bg-surface border-b border-line flex items-center gap-2 px-4">
        <span className="font-bold text-lg truncate">
          {pageTitle(pathname, groups)}
        </span>
        <div className="ml-auto shrink-0">
          <SyncChip collapsed={false} />
        </div>
      </header>

      {/* Phone navigation. Four pages used all day get a tab; the rest live in
          the "Lainnya" sheet. Same routes as the desktop sidebar. */}
      <nav
        aria-label="Menu utama"
        style={{ height: TAB_BAR_H }}
        className="md:hidden fixed bottom-0 inset-x-0 z-50 grid grid-cols-5 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)]"
      >
        {TAB_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={tabBase}
            activeProps={{ className: `${tabBase} text-brand` }}
          >
            <span className={`${tabPill} group-data-[status=active]:bg-brand-soft`}>
              <item.Icon className="h-5 w-5" />
            </span>
            {item.label}
          </Link>
        ))}
        <button
          ref={moreRef}
          onClick={() => setSheetOpen((o) => !o)}
          aria-expanded={sheetOpen}
          aria-controls="menu-lainnya"
          className={`${tabBase} cursor-pointer ${moreActive ? "text-brand" : ""}`}
        >
          <span className={`${tabPill} ${moreActive ? "bg-brand-soft" : ""}`}>
            <MoreIcon className="h-5 w-5" strokeWidth={3} />
          </span>
          Lainnya
        </button>
      </nav>

      {sheetOpen && (
        <>
          <div
            onClick={() => setSheetOpen(false)}
            aria-hidden
            className="md:hidden fixed inset-0 z-30 bg-ink/40"
          />
          <div
            ref={sheetRef}
            id="menu-lainnya"
            role="dialog"
            aria-label="Menu lainnya"
            style={{ bottom: TAB_BAR_H }}
            className="md:hidden fixed inset-x-0 z-40 max-h-[75vh] overflow-y-auto bg-surface rounded-t-xl border-t border-line px-3 pt-2 pb-3 shadow-[0_-8px_24px_rgb(20_32_31/0.12)]"
          >
            {sheetGroups.map((group) => (
              <div key={group.label}>
                <div className="px-1 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                  {group.label}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="flex flex-col items-center justify-center gap-1 min-h-16 px-1 rounded-md text-xs font-semibold text-body text-center hover:bg-surface-hover"
                      activeProps={{
                        className:
                          "flex flex-col items-center justify-center gap-1 min-h-16 px-1 rounded-md text-xs font-semibold text-center bg-brand-soft text-brand",
                      }}
                    >
                      <item.Icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <div className="px-1 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
              {BACKUP_GROUP}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {dataActions
                .filter((a) => a.show)
                .map((a) => (
                  <button
                    key={a.key}
                    onClick={a.onClick}
                    className="flex flex-col items-center justify-center gap-1 min-h-16 px-1 rounded-md text-xs font-semibold text-body text-center hover:bg-surface-hover cursor-pointer"
                  >
                    <a.Icon className="h-5 w-5" />
                    {a.label}
                  </button>
                ))}
            </div>
          </div>
        </>
      )}

      <aside
        id="nav-utama"
        className={`hidden md:flex md:sticky md:top-0 md:h-screen md:shrink-0 ${
          iconOnly ? "md:w-16" : "md:w-56"
        } motion-safe:transition-[width] bg-surface border-r border-line p-3 flex-col`}
      >
        <div className="shrink-0 flex items-center justify-between mb-4">
          {!iconOnly && (
            <span className="flex items-center gap-2 font-bold text-lg px-2">
              <FileTextIcon className="h-5 w-5 text-brand" />
              Invoice
            </span>
          )}
          <button
            onClick={toggle}
            title={collapsed ? "Buka sidebar" : "Tutup sidebar"}
            aria-label="Toggle sidebar"
            className="ml-auto p-2 rounded-md text-faint hover:bg-surface-hover cursor-pointer"
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
            const groupActive = group.items.some((item) =>
              isActivePath(pathname, item.to),
            );
            return (
              <div key={group.label} className="flex flex-col gap-0.5">
                {iconOnly ? (
                  // Icon-only mode: a thin divider separates groups; items always show.
                  gi > 0 && <div className="my-2 border-t border-line" />
                ) : (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={!groupClosed}
                    className={`flex items-center gap-1 px-2.5 text-[11px] uppercase tracking-wide cursor-pointer ${
                      gi > 0 ? "pt-3 pb-1" : "pt-1 pb-1"
                    } ${
                      groupActive
                        ? "text-brand font-semibold"
                        : "text-faint font-semibold hover:text-muted"
                    }`}
                  >
                    <ChevronDownIcon
                      className={`h-3 w-3 transition-transform ${
                        groupClosed ? "-rotate-90" : ""
                      }`}
                    />
                    {group.label}
                  </button>
                )}
                {(iconOnly || !groupClosed) &&
                  group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      title={item.label}
                      className={`${linkBase} ${
                        iconOnly ? "justify-center px-0" : ""
                      }`}
                      activeProps={{
                        className: `${linkBase} ${linkActive} ${
                          iconOnly ? "justify-center px-0" : ""
                        }`,
                      }}
                    >
                      <item.Icon className="h-5 w-5 shrink-0" />
                      {!iconOnly && item.label}
                    </Link>
                  ))}
              </div>
            );
          })}

          {/* The last group, and the reason it is written out here rather than
              added to NAV_GROUPS: every group above is a list of DESTINATIONS,
              rendered as <Link>. These are actions on the whole dataset — they
              open a dialog, they do not navigate — so they share the groups'
              markup and their collapse state but not their data shape.

              It lives inside <nav> so it scrolls and folds exactly like the
              others; only the sync chip stays pinned below. */}
          <div className="flex flex-col gap-0.5">
            {iconOnly ? (
              <div className="my-2 border-t border-line" />
            ) : (
              <button
                onClick={() => toggleGroup(BACKUP_GROUP)}
                aria-expanded={!closedGroups.has(BACKUP_GROUP)}
                className="flex items-center gap-1 px-2.5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint hover:text-muted cursor-pointer"
              >
                <ChevronDownIcon
                  className={`h-3 w-3 transition-transform ${
                    closedGroups.has(BACKUP_GROUP) ? "-rotate-90" : ""
                  }`}
                />
                {BACKUP_GROUP}
              </button>
            )}
            {(iconOnly || !closedGroups.has(BACKUP_GROUP)) &&
              dataActions
                .filter((a) => a.show)
                .map((a) => (
                  <button
                    key={a.key}
                    onClick={a.onClick}
                    title={a.title}
                    className={`${linkBase} ${iconOnly ? "justify-center px-0" : ""} cursor-pointer`}
                  >
                    <a.Icon className="h-5 w-5 shrink-0" />
                    {!iconOnly && a.label}
                  </button>
                ))}
          </div>
        </nav>

        {/* Pinned below the scroll area on purpose, and now the only thing that
            is. The chip REPORTS rather than offers, and a status you have to
            scroll to — or expand a section to reach — is a status nobody reads,
            which is the whole reason it is a chip and not a nav link. */}
        {/* Hidden below md: the same chip already sits in the app bar there,
            and two of them would report the same state twice. */}
        <div className="shrink-0 pt-3 flex flex-col gap-1">
          <SyncChip collapsed={iconOnly} />
          {!iconOnly && (
            <div className="px-2.5 pt-2 text-xs text-faint">
              Tersimpan lokal di browser
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 pt-14 pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <div className="max-w-[1400px] mx-auto p-4 md:p-6">
          <StaleBacklogBanner />
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
          <p className="font-semibold text-danger-text">
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
          <p className="font-semibold text-danger-text">
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
          <p className="font-semibold text-danger-text">
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
              result.ok ? "text-ok-text" : "text-danger-text"
            }`}
          >
            {result.ok ? "Selesai" : "Gagal"}
          </h2>
          <p className="text-sm text-muted mb-5">{result.message}</p>
          {result.note && (
            <p className="text-sm text-muted mb-5">{result.note}</p>
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

// R4: a backlog that is merely large is normal — one written a fortnight ago
// is not. Six orders sat unpushed on a second device for six days in September
// 2026 and nothing outside the sync panel ever said so, which is why they were
// lost rather than noticed. See docs/2026-09-23/data-loss-rules.md (R4).
//
// Deliberately NOT shown when the account is local-only or the API is absent:
// those devices diverge permanently by design, so the warning would be
// constant, and a warning that is always on is one nobody reads.
function StaleBacklogBanner() {
  const status = useSyncStatus();
  if (!status.available || !status.canPush) return null;

  const days = stalenessDays(status.pendingSince);
  if (days === null || days < 1) return null;

  return (
    <div className="mb-4 rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger-text">
      <p className="font-semibold">
        {formatAngka(status.pendingTotal)} baris belum tersimpan di cloud,
        yang terlama sudah {formatAngka(days)} hari.
      </p>
      <p className="mt-1">
        Data ini baru ada di perangkat ini. Buka panel sinkronisasi lalu coba
        kirim ulang — kalau tetap gagal, simpan cadangan dulu sebelum menghapus
        apa pun.
      </p>
    </div>
  );
}
