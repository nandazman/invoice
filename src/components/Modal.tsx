import { useEffect, type ReactNode } from "react";

// Mount order of every open Modal, innermost last.
const open: object[] = [];

// The overlay every dialog was repeating: click-outside to close, Escape to
// close, and a panel that swallows its own clicks. Only the panel's width and
// padding ever differed between them, so that is the one prop — `className`.
export function Modal({
  onClose,
  className = "bg-white rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-auto",
  overlayClassName = "z-50",
  children,
}: {
  onClose: () => void;
  className?: string;
  // Only the nested confirm inside BuyFromOrderDialog needs this, to sit above
  // the dialog that opened it.
  overlayClassName?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    // Modals can nest (BuyFromOrderDialog opens a confirm over itself). Every
    // one listens on window, so without this stack a single Escape would close
    // the confirm AND the dialog underneath it. Only the topmost reacts.
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
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 bg-black/40 flex items-center justify-center p-4 ${overlayClassName}`}
      onClick={onClose}
    >
      <div className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
