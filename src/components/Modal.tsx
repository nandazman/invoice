import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Mount order of every open overlay, innermost last. Modals nest, and the
// mobile nav drawer can sit under one of them, so a single Escape must reach
// exactly one of them.
const open: object[] = [];

// Escape-to-close, sharing the stack above. Exported because the nav drawer in
// RootLayout is an overlay too but not a Modal: it is not centred, it does not
// take a backdrop click the same way, and it must not be able to close from
// under an open dialog.
export function useEscapeToClose(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const token = {};
    open.push(token);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open[open.length - 1] === token) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      open.splice(open.indexOf(token), 1);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, active]);
}

// Every dialog is a bottom sheet on a phone (full-width, anchored to the
// bottom edge, capped short of the viewport so it never hides behind the
// keyboard) and a centred dialog from `md` up. This is `!important` so it
// always wins regardless of what a caller passes as `className` — every
// existing call site already sets its own `rounded-*`/`max-h-*`, and losing
// the sheet shape to that would defeat the point of making it the default.
const panelShape = "!rounded-t-2xl md:!rounded-xl !max-h-[85vh]";

// The overlay every dialog was repeating: click-outside to close, Escape to
// close, and a panel that swallows its own clicks. Only the panel's width and
// padding ever differed between them, so that is the one prop — `className`.
export function Modal({
  onClose,
  className = "bg-surface p-5 w-full max-w-md overflow-auto",
  overlayClassName = "z-50",
  closeOnOverlay = true,
  children,
}: {
  onClose: () => void;
  className?: string;
  // Only the nested confirm inside BuyFromOrderDialog needs this, to sit above
  // the dialog that opened it.
  overlayClassName?: string;
  // Set false for dialogs holding enough state that a stray click outside is
  // more likely a misclick than an intent to close.
  closeOnOverlay?: boolean;
  children: ReactNode;
}) {
  // Modals can nest (BuyFromOrderDialog opens a confirm over itself), so only
  // the topmost overlay reacts to Escape.
  useEscapeToClose(onClose);

  const overlay = (
    <div
      className={`fixed inset-0 bg-black/40 flex items-end md:items-center justify-center p-4 ${overlayClassName}`}
      onClick={closeOnOverlay ? onClose : undefined}
    >
      <div
        className={`${panelShape} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  // Portalled to <body>, and this is load-bearing rather than tidiness. A CSS
  // transform on ANY ancestor makes that element the containing block for
  // `position: fixed` descendants, so `inset-0` stops meaning "the viewport"
  // and starts meaning "that ancestor". The sidebar in RootLayout carries
  // `translate-x-0`/`-translate-x-full` for its mobile slide-in and keeps
  // `md:translate-x-0` on desktop, so every dialog opened from inside it — the
  // sync panel above all — rendered squeezed into a 224px column with no
  // backdrop over the page. Escaping to <body> fixes it for every caller at
  // once, and keeps working if another transformed ancestor shows up later.
  //
  // Falls back to rendering in place where there is no document.body: the node
  // test environment stubs `document` without one (test-setup.ts).
  return typeof document !== "undefined" && document.body
    ? createPortal(overlay, document.body)
    : overlay;
}
