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
import { ExcelPage } from "./routes/ExcelPage";
import { TemplatePage } from "./routes/TemplatePage";
import { InvoicePage } from "./routes/InvoicePage";
import { StockPage } from "./routes/StockPage";
import { BeliStockPage } from "./routes/BeliStockPage";
import { HistoryPage } from "./routes/HistoryPage";

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

const routeTree = rootRoute.addChildren([
  indexRoute,
  pricesRoute,
  productDetailRoute,
  ordersRoute,
  stockRoute,
  beliStockRoute,
  excelRoute,
  templateRoute,
  invoiceRoute,
  historyRoute,
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
