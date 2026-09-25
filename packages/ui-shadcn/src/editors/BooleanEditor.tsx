import { useEffect, useRef, useState } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Checkbox } from "../ui/checkbox";
import { FieldMessage } from "./EditorCard";
import { isGridMode, useAutoFocus } from "./useEditorKeys";

export type BooleanEditorProps = UiEditorProps<boolean, unknown> & {
  /**
   * Flip the value and commit on mount — the grid adapter sets it when the
   * edit was started by Space or a click, so a boolean cell toggles in place
   * (never a popup).
   */
  toggleOnMount?: boolean;
};

/**
 * Inline 16px checkbox editor. Toggling (click or Space) reports the value
 * and commits immediately; in-cell it sits exactly where the renderer's
 * checkbox is, so the cell appears to toggle in place.
 */
export function BooleanEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error, toggleOnMount }: BooleanEditorProps) {
  const [checked, setChecked] = useState(value === true);
  const ref = useRef<HTMLButtonElement>(null);
  const gridMode = isGridMode(autoFocus);
  useAutoFocus(ref, autoFocus);

  const set = (next: boolean) => {
    setChecked(next);
    onChange(next);
    onCommit(next);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only.
  useEffect(() => {
    if (toggleOnMount) set(!(value === true));
  }, []);

  return (
    <div className={cn(SG_ROOT, "sg:flex sg:items-center", gridMode ? "sg:h-full sg:w-full sg:px-2" : "sg:min-h-8 sg:flex-col sg:items-start sg:justify-center sg:gap-1")}>
      <Checkbox
        ref={ref}
        checked={checked}
        aria-label={column.label || undefined}
        aria-invalid={error ? true : undefined}
        onCheckedChange={(next) => set(next === true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {!gridMode ? <FieldMessage>{error}</FieldMessage> : null}
    </div>
  );
}
