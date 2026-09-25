import { useEffect, useRef, useState } from "react";
import { useGridCellEditor } from "ag-grid-react";
import type { GridRow } from "../internal/core";
import { parseEditorInput, type SchemaCellEditorProps } from "./TextEditor";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC ISO → the local `YYYY-MM-DDTHH:mm` a `datetime-local` input expects. */
function isoToLocalInput(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Inline native date editor: `<input type="date">` for date ("YYYY-MM-DD") and
 * `<input type="datetime-local">` for datetime (shown in local time, stored as
 * UTC ISO). A native date input cannot hold partial typed text, so unlike the
 * text editors this one always starts from the current value, ignoring a
 * printable start key. An unparseable value cancels on end.
 */
export function DateEditor<Row extends GridRow = GridRow>(props: SchemaCellEditorProps<Row>): JSX.Element {
  const { schemaColumn, fieldType } = props;
  const isDateTime = schemaColumn?.type === "datetime";
  const [text, setText] = useState<string>(() =>
    isDateTime ? isoToLocalInput(props.value) : typeof props.value === "string" ? props.value : "",
  );
  const invalidRef = useRef(false);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useGridCellEditor({ isCancelAfterEnd: () => invalidRef.current });

  const apply = (next: string): void => {
    setText(next);
    // `new Date("YYYY-MM-DDTHH:mm")` parses as local time, which is what the input shows.
    const input: unknown = isDateTime && next !== "" ? new Date(next) : next;
    const result = parseEditorInput(input, schemaColumn, fieldType);
    invalidRef.current = !result.ok;
    if (result.ok) props.onValueChange(result.value);
  };

  return (
    <input
      ref={ref}
      className="sg-cell-editor sg-date-editor"
      type={isDateTime ? "datetime-local" : "date"}
      aria-label={schemaColumn?.label}
      value={text}
      onChange={(e) => apply(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          invalidRef.current = false;
          props.onValueChange(props.initialValue);
        }
      }}
    />
  );
}
