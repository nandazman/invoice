import type { ReactNode } from "react";
import { DangerGhostButton } from "./Button";
import { CloseIcon } from "./icons";

// The title row every dialog opens with: heading on the left, an X on the right.
// The X is a ghost button that stays grey, not red: it dismisses, it
// does not delete, so it is grey at rest too (DangerGhostButton alone is red).
export function DialogHeader({
  children,
  onClose,
  id,
  className = "text-lg",
  disabled,
}: {
  children: ReactNode;
  onClose: () => void;
  id?: string;
  // Size and colour of the heading; spacing below belongs to this row.
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h2 id={id} className={`font-bold flex-1 min-w-0 ${className}`}>
        {children}
      </h2>
      <DangerGhostButton
        onClick={onClose}
        disabled={disabled}
        aria-label="Tutup"
        title="Tutup"
        className="!text-muted hover:!bg-surface-hover hover:!text-body"
      >
        <CloseIcon />
      </DangerGhostButton>
    </div>
  );
}
