import { useEffect, useRef, useState } from "react";
import type { GridRow } from "../internal/core";
import type { SchemaCellEditorProps } from "./TextEditor";

/**
 * Inline checkbox editor. Clicking (or Space on the focused box) toggles and
 * reports the value; an edit started by pressing Space toggles immediately.
 * Enter/Tab commit through the grid; Esc reports the original value back.
 */
export function BooleanEditor<Row extends GridRow = GridRow>(props: SchemaCellEditorProps<Row>): JSX.Element {
  const [checked, setChecked] = useState<boolean>(() => props.value === true);
  const ref = useRef<HTMLInputElement | null>(null);

  const set = (next: boolean): void => {
    setChecked(next);
    props.onValueChange(next);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only.
  useEffect(() => {
    ref.current?.focus();
    if (props.eventKey === " ") set(!(props.value === true));
  }, []);

  return (
    <input
      ref={ref}
      className="sg-cell-editor sg-boolean-editor"
      type="checkbox"
      aria-label={props.schemaColumn?.label}
      checked={checked}
      onChange={(e) => set(e.target.checked)}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onValueChange(props.initialValue);
      }}
    />
  );
}
