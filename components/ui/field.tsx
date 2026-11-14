import type { ReactNode } from "react";
import { cn } from "./cn";
import { Input, type InputProps } from "./input";

export type FieldProps = Omit<InputProps, "id" | "children"> & {
  /** Required: the label's `htmlFor` and the described-by ids derive from it. */
  id: string;
  label: string;
  helper?: ReactNode;
  /** Set to show an error; also sets `aria-invalid` on the input. */
  error?: string | null;
};

/**
 * Label, input, helper and error text, tied together with `htmlFor` and
 * `aria-describedby`. A server component: the caller supplies a stable `id`
 * (for example `${mode}-email`) so no hook is needed.
 */
export function Field({
  id,
  label,
  helper,
  error,
  className,
  ...inputProps
}: FieldProps) {
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {helper ? (
        <p id={helperId} className="text-xs text-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
