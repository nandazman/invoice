import { useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { exportAll, importAll } from "../lib/backup";
import { flushWrites } from "../lib/db";
import { downloadJSON, pickJSONFile } from "../lib/io";

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
];

export function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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

  function doBackup() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJSON(`invoice-backup-${stamp}.json`, exportAll());
  }

  async function doRestore() {
    if (
      !confirm(
        "Pulihkan dari cadangan? Ini akan mengganti SEMUA data (produk, pesanan, stok, tipe, template, riwayat). Tindakan ini tidak bisa dibatalkan.",
      )
    )
      return;
    try {
      const text = await pickJSONFile();
      importAll(text);
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
      alert("Data berhasil dipulihkan.");
    } catch (e) {
      alert("Gagal memulihkan: " + (e as Error).message);
    }
  }

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
          {NAV_GROUPS.map((group, gi) => {
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
          <button
            onClick={doBackup}
            title="Backup semua data"
            className={`${linkBase} ${collapsed ? "justify-center px-0" : ""} cursor-pointer`}
          >
            <span className="text-base">💾</span>
            {!collapsed && "Backup semua"}
          </button>
          <button
            onClick={doRestore}
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
    </div>
  );
}
