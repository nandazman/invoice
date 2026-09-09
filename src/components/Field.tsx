import { createContext, useContext, useId } from "react";
import type { ReactNode } from "react";

// The input that an error belongs to is passed in as `children`, so the field
// publishes the error id through context instead of asking every form to thread
// `aria-describedby` by hand. <Input> picks it up automatically.
interface FieldError {
  id: string;
  invalid: boolean;
}
const FieldErrorContext = createContext<FieldError | null>(null);

export function useFieldError() {
  return useContext(FieldErrorContext);
}

export function Field({
  label,
  className = "",
  error,
  children,
}: {
  label: string;
  className?: string;
  error?: string;
  children: ReactNode;
}) {
  const errorId = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-semibold text-faint">{label}</span>
      <FieldErrorContext.Provider value={{ id: errorId, invalid: !!error }}>
        {children}
      </FieldErrorContext.Provider>
      {error && (
        <span id={errorId} className="text-xs font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
