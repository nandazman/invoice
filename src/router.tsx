import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  redirect,
} from "@tanstack/react-router";
import { RootLayout } from "./routes/RootLayout";
import { PricesPage } from "./routes/PricesPage";
import { OrdersPage } from "./routes/OrdersPage";
import { ExcelPage } from "./routes/ExcelPage";
import { TemplatePage } from "./routes/TemplatePage";
import { InvoicePage } from "./routes/InvoicePage";
import { StockPage } from "./routes/StockPage";

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

const routeTree = rootRoute.addChildren([
  indexRoute,
  pricesRoute,
  ordersRoute,
  stockRoute,
  excelRoute,
  templateRoute,
  invoiceRoute,
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
