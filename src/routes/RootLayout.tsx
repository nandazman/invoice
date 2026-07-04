import { useState } from "react";
import { Link, Outlet } from "@tanstack/react-router";

const COLLAPSE_KEY = "invoice.sidebar.collapsed";

const linkBase =
  "flex items-center gap-2.5 px-3 py-2.5 rounded-lg font-semibold text-slate-500 hover:bg-slate-100 transition-colors";
const linkActive = "bg-blue-50 text-blue-600 hover:bg-blue-50";

export function RootLayout() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
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
          <Link
            to="/harga"
            title="Harga"
            className={`${linkBase} ${collapsed ? "justify-center px-0" : ""}`}
            activeProps={{
              className: `${linkBase} ${linkActive} ${
                collapsed ? "justify-center px-0" : ""
              }`,
            }}
          >
            <span className="text-base">🏷️</span>
            {!collapsed && "Harga"}
          </Link>
          <Link
            to="/pesanan"
            title="Pesanan"
            className={`${linkBase} ${collapsed ? "justify-center px-0" : ""}`}
            activeProps={{
              className: `${linkBase} ${linkActive} ${
                collapsed ? "justify-center px-0" : ""
              }`,
            }}
          >
            <span className="text-base">📦</span>
            {!collapsed && "Pesanan"}
          </Link>
          <Link
            to="/stok"
            title="Stok"
            className={`${linkBase} ${collapsed ? "justify-center px-0" : ""}`}
            activeProps={{
              className: `${linkBase} ${linkActive} ${
                collapsed ? "justify-center px-0" : ""
              }`,
            }}
          >
            <span className="text-base">🏬</span>
            {!collapsed && "Stok"}
          </Link>
          <Link
            to="/excel"
            title="Ekspor Excel"
            className={`${linkBase} ${collapsed ? "justify-center px-0" : ""}`}
            activeProps={{
              className: `${linkBase} ${linkActive} ${
                collapsed ? "justify-center px-0" : ""
              }`,
            }}
          >
            <span className="text-base">📊</span>
            {!collapsed && "Ekspor Excel"}
          </Link>
          <Link
            to="/template"
            title="Desain Template"
            className={`${linkBase} ${collapsed ? "justify-center px-0" : ""}`}
            activeProps={{
              className: `${linkBase} ${linkActive} ${
                collapsed ? "justify-center px-0" : ""
              }`,
            }}
          >
            <span className="text-base">🎨</span>
            {!collapsed && "Desain Template"}
          </Link>
          <Link
            to="/invoice"
            title="Buat Invoice"
            className={`${linkBase} ${collapsed ? "justify-center px-0" : ""}`}
            activeProps={{
              className: `${linkBase} ${linkActive} ${
                collapsed ? "justify-center px-0" : ""
              }`,
            }}
          >
            <span className="text-base">🧾</span>
            {!collapsed && "Buat Invoice"}
          </Link>
        </nav>

        {!collapsed && (
          <div className="mt-auto px-2.5 pt-3 text-xs text-slate-400">
            Tersimpan lokal di browser
          </div>
        )}
      </aside>

      <main className="flex-1 min-w-0">
        <div className="max-w-5xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
