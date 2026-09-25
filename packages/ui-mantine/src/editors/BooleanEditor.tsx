import { Checkbox } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";

/**
 * Minimal fallback editor for booleans (the grid toggles booleans in place;
 * this only renders if something still opens an editor): a small centred
 * checkbox. Click toggles and commits; Space toggles; Enter commits.
 */
export function BooleanEditor({ value, onChange, onCommit, onCancel, column, autoFocus }: UiEditorProps<boolean, unknown>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState(value ?? false);
  const viaKeyboard = useRef(false);

  useEffect(() => {
    if (autoFocus !== false) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
      <Checkbox
        ref={inputRef}
        size="xs"
        radius="xs"
        checked={checked}
        aria-label={column.label || undefined}
        onKeyDown={(event) => {
          if (event.key === " ") viaKeyboard.current = true;
          else if (event.key === "Enter") {
            event.preventDefault();
            onCommit(checked);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onChange={(event) => {
          const next = event.currentTarget.checked;
          setChecked(next);
          onChange(next);
          // A click is a complete edit; Space only toggles (Enter commits).
          if (!viaKeyboard.current) onCommit(next);
          viaKeyboard.current = false;
        }}
      />
    </span>
  );
}
