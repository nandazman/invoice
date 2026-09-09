import { useId, type ReactNode } from "react";
import { Button, PrimaryButton, DangerButton } from "./Button";
import { Modal } from "./Modal";

// The one confirmation dialog. It exists to replace `window.confirm()`, which
// freezes the whole page (no re-render, no sync tick, no scrolling the warning
// you are being asked to read) and can only ever show one unstyled line of
// text. A confirmation that has to explain consequences needs paragraphs and a
// danger style, so it has to be React.
//
// Escape, the backdrop click and the nesting stack all come from Modal — this
// only adds the body, the buttons, and the labelling.
export function ConfirmDialog({
  title,
  confirmLabel,
  cancelLabel = "Batal",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  // Destructive actions get the red button AND a red-bordered panel, so the
  // weight of the dialog matches the weight of the click.
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  // The explanation: what actually happens, what cannot be undone, and what
  // stays untouched. Prose, not a one-liner.
  children: ReactNode;
}) {
  const titleId = useId();
  const Confirm = danger ? DangerButton : PrimaryButton;

  return (
    <Modal
      onClose={onClose}
      className={`bg-surface rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-auto border ${
        danger ? "border-danger-line" : "border-line"
      }`}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2
          id={titleId}
          className={`text-lg font-bold mb-2 ${danger ? "text-danger-text" : ""}`}
        >
          {title}
        </h2>
        <div className="text-sm text-muted space-y-2 mb-5">{children}</div>
        <div className="flex justify-end gap-2">
          {/* Focus starts inside the dialog so the keyboard works immediately.
              On a destructive one it starts on "Batal", so a reflex Enter
              cancels rather than destroys; harmless ones focus the confirm. */}
          <Button autoFocus={danger} onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Confirm autoFocus={!danger} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Confirm>
        </div>
      </div>
    </Modal>
  );
}
