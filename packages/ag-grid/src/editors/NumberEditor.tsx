import type { GridRow } from "../internal/core";
import { type SchemaCellEditorProps, useParsedTextEditor } from "./TextEditor";

/**
 * Inline editor for number and currency. Uses a text input (not
 * `type="number"`) so invalid text stays visible; while the text does not
 * parse, the edit is cancelled on end and the previous value is kept.
 */
export function NumberEditor<Row extends GridRow = GridRow>(props: SchemaCellEditorProps<Row>): JSX.Element {
  const { text, apply, inputRef, onKeyDown, invalidRef } = useParsedTextEditor(props);
  return (
    <input
      ref={(el) => {
        inputRef.current = el;
      }}
      className="sg-cell-editor sg-number-editor"
      type="text"
      inputMode="decimal"
      aria-label={props.schemaColumn?.label}
      aria-invalid={invalidRef.current || undefined}
      value={text}
      onChange={(e) => apply(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
