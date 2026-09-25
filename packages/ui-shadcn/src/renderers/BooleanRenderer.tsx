import { CheckIcon } from "lucide-react";
import type { UiRendererProps } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";

/**
 * Boolean cell: a read-only 16px checkbox visual (never "true"/"false"
 * text). It is display only — toggling happens through the inline
 * `BooleanEditor` (and, once ag-grid ships it, in place in the cell).
 */
export function BooleanRenderer({ value, column }: UiRendererProps<boolean, unknown>) {
  const checked = value === true;
  return (
    <span className={cn(SG_ROOT, "sg:flex sg:h-full sg:cursor-default sg:items-center")}>
      {/* biome-ignore lint/a11y/useFocusableInteractive: display-only; the grid cell owns focus and the editor toggles it. */}
      <span
        // biome-ignore lint/a11y/useSemanticElements: display-only checkbox visual (the grid cell is the focus target).
        role="checkbox"
        aria-checked={checked}
        aria-readonly
        aria-label={column.label || undefined}
        data-state={checked ? "checked" : "unchecked"}
        className={cn(
          "sg:grid sg:size-4 sg:shrink-0 sg:place-content-center sg:rounded-sm sg:border sg:shadow-xs",
          checked ? "sg:border-primary sg:bg-primary sg:text-primary-foreground" : "sg:border-input-hover sg:bg-background",
        )}
      >
        {checked ? <CheckIcon aria-hidden className="sg:size-3" strokeWidth={3} /> : null}
      </span>
    </span>
  );
}
