import { useEffect, useRef, useState } from "react";
import type { GridRow, Option } from "../internal/core";
import { parseEditorInput, type SchemaCellEditorProps } from "./TextEditor";

/** Reads `config.options` off a select-like column. */
export function columnOptions(config: unknown): Option[] {
  const options = (config as { options?: unknown } | null | undefined)?.options;
  return Array.isArray(options) ? (options as Option[]) : [];
}

/**
 * Inline native `<select>` over `config.options` plus an empty option (clears
 * to null). Changing the selection reports the value; Enter/Tab commit
 * through the grid; Esc reports the original value back.
 */
export function SelectEditor<Row extends GridRow = GridRow>(props: SchemaCellEditorProps<Row>): JSX.Element {
  const { schemaColumn, fieldType } = props;
  const options = columnOptions(schemaColumn?.config ?? fieldType?.defaultConfig);
  const [selected, setSelected] = useState<string>(() => (typeof props.value === "string" ? props.value : ""));
  const ref = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <select
      ref={ref}
      className="sg-cell-editor sg-select-editor"
      aria-label={schemaColumn?.label}
      value={selected}
      onChange={(e) => {
        const next = e.target.value;
        setSelected(next);
        const result = parseEditorInput(next, schemaColumn, fieldType);
        if (result.ok) props.onValueChange(result.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onValueChange(props.initialValue);
      }}
    >
      <option value="" />
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
