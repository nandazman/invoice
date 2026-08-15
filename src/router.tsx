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
// The sidebar only shows "Sinkronisasi" to an admin, but this route stays
// registered for EVERYONE on purpose. A `read` user reaches it by direct URL —
// an admin pastes them the link — and needs it for "Mode coba-coba" and "Buang
// perubahan lokal". AdminPage already gates each section by role. Hiding the
// nav entry is the whole change; do not "finish the job" by removing the route.
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
