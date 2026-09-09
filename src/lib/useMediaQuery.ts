import { useCallback, useSyncExternalStore } from "react";

// A media query as reactive state. The drawer and the desktop sidebar are the
// SAME DOM node — one `aside` that is off-canvas below `md` and a static column
// above it — and the icon-only collapse belongs to the desktop half only. CSS
// alone cannot express that: `collapsed` decides what is RENDERED (labels, group
// headers), not just how it looks, so the layout has to be able to ask which
// half it is in.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // No SSR here, but a matchMedia call would throw in any non-browser render.
    () => false,
  );
}
