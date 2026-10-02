import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useSyncStatus, isBlocked } from "../lib/sync/client";
import { useMediaQuery } from "../lib/useMediaQuery";
import { GateScreen } from "../components/GateScreen";
import { useEscapeToClose, useScrollLock } from "../components/Modal";
import { SyncChip } from "../components/SyncChip";
import {
  BoxIcon,
  CartIcon,
  ChartIcon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  GearIcon,
  MoreIcon,
  PenToolIcon,
  SheetIcon,
  StoreIcon,
  TagIcon,
  UsersIcon,
} from "../components/icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const COLLAPSE_KEY = "invoice.sidebar.collapsed";
const GROUPS_KEY = "invoice.sidebar.groups";

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

  // The gate. Below every hook on purpose — an early return above them would
  // change the hook count between renders the moment /api/sync/me answers.
  //
  // The condition is entirely inside `isBlocked` (client.ts), which is where
  // the reasoning about its three terms lives. In particular this must NOT
  // become `status.role === "none"`: that blanks the GitHub Pages copy, which
  // has no API to ask and therefore no role.
  if (isBlocked(status)) return <GateScreen email={status.email} />;

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

        </nav>

        {/* Pinned below the scroll area on purpose, and now the only thing that
            is. The chip REPORTS rather than offers, and a status you have to
            scroll to — or expand a section to reach — is a status nobody reads,
            which is the whole reason it is a chip and not a nav link. */}
        {/* Hidden below md: the same chip already sits in the app bar there,
            and two of them would report the same state twice. */}
        <div className="shrink-0 pt-3 flex flex-col gap-1">
          <SyncChip collapsed={iconOnly} />
        </div>
      </aside>

      <main className="flex-1 min-w-0 pt-14 pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <div className="max-w-[1400px] mx-auto p-4 md:p-6">
          <Outlet />
        </div>
      </main>

    </div>
  );
}
