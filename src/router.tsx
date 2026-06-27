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

const routeTree = rootRoute.addChildren([
  indexRoute,
  pricesRoute,
  ordersRoute,
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
