import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  redirect,
} from "@tanstack/react-router";
import { RootLayout } from "./routes/RootLayout";
import { PricesPage } from "./routes/PricesPage";
import { ProductDetailPage } from "./routes/ProductDetailPage";
import { OrdersPage } from "./routes/OrdersPage";
import { BuyersPage } from "./routes/BuyersPage";
import { BuyerDetailPage } from "./routes/BuyerDetailPage";
import { ExcelPage } from "./routes/ExcelPage";
import { TemplatePage } from "./routes/TemplatePage";
import { InvoicePage } from "./routes/InvoicePage";
import { StockPage } from "./routes/StockPage";
import { BeliStockPage } from "./routes/BeliStockPage";
import { HistoryPage } from "./routes/HistoryPage";
import { ReportPage } from "./routes/ReportPage";
import { AdminPage } from "./routes/AdminPage";

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/harga" });
  },
});

const pricesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/harga",
  component: PricesPage,
});

const productDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/produk/$id",
  component: ProductDetailPage,
});

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pesanan",
  component: OrdersPage,
});

const buyersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pembeli",
  component: BuyersPage,
});

const buyerDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pembeli/$id",
  component: BuyerDetailPage,
});

const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stok",
  component: StockPage,
});

const beliStockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/beli-stok",
  component: BeliStockPage,
});

const excelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/excel",
  component: ExcelPage,
});

const templateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/template",
  component: TemplatePage,
});

const invoiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invoice",
  component: InvoicePage,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/riwayat",
  component: HistoryPage,
});

const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/laporan",
  component: ReportPage,
});

// Hash routing means the server never sees this path, so it cannot be guarded
// by an Access policy. Enforcement lives on /api/admin/* — see sync-plan.md.
//
// This page is now genuinely admin-only: roles and the D1 dashboard, nothing
// else. It used to stay registered for everyone because a `read` user needed
// it for "Mode coba-coba" and "Buang perubahan lokal" — that role no longer
// exists, scratch mode is deleted, and discard moved to the sync chip in the
// sidebar (docs/2026-08-15/permissions-plan.md §C). Nobody but an admin has a
// reason to open it.
//
// The route is still registered for everyone, and that is deliberate: hiding
// it from the router would only turn a direct URL into a blank "not found"
// instead of the page's own explanation of why the panels are empty. The check
// that matters is the Access application in front of /api/admin/*, not this
// table.
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  pricesRoute,
  productDetailRoute,
  ordersRoute,
  buyersRoute,
  buyerDetailRoute,
  stockRoute,
  beliStockRoute,
  excelRoute,
  templateRoute,
  invoiceRoute,
  historyRoute,
  reportRoute,
  adminRoute,
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
