import { type ReactNode, useId } from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

export interface FieldProps {
  label?: ReactNode;
  /** Muted 12px helper under the control. */
  description?: ReactNode;
  /** Shown only when set — callers pass it after touch/submit. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  /** Render prop receives ids to wire `aria-describedby` / `aria-invalid`. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label + control + helper/error stack (errors replace the helper, role="alert"). */
export function Field({ label, description, error, required, className, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const hasHelp = Boolean(error) || Boolean(description);
  return (
    <div className={cn("sg:flex sg:flex-col sg:gap-1.5", className)}>
      {label ? (
        <Label htmlFor={id}>
          {label}
          {required ? (
            <span aria-hidden className="sg:text-danger">
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      {children({ id, describedBy: hasHelp ? helpId : undefined, invalid: Boolean(error) })}
      {error ? (
        <p id={helpId} role="alert" className="sg:text-xs sg:text-danger">
          {error}
        </p>
      ) : description ? (
        <p id={helpId} className="sg:text-xs sg:text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
