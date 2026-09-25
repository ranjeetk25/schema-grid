import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { type CustomCellEditorProps, useGridCellEditor } from "ag-grid-react";
import type { ColumnDef, FieldType, GridRow, ParseResult } from "../internal/core";

/**
 * Props every schema editor receives: AG Grid's reactive editor props plus the
 * `schemaColumn`/`fieldType` that `compileColumns` puts in `cellEditorParams`
 * (AG Grid merges those params onto the component props).
 */
export type SchemaCellEditorProps<Row extends GridRow = GridRow> = CustomCellEditorProps<Row> & {
  schemaColumn?: ColumnDef;
  fieldType?: FieldType<unknown, unknown>;
};

/** Column config to pass to `fieldType.parse`/`format` (the column's own, else the type default). */
export function editorConfig(column: ColumnDef | undefined, fieldType: FieldType<unknown, unknown> | undefined): unknown {
  return column?.config ?? fieldType?.defaultConfig;
}

/** Parses editor input with the column's field type; with no field type, empty → null, else the raw input. */
export function parseEditorInput(
  input: unknown,
  column: ColumnDef | undefined,
  fieldType: FieldType<unknown, unknown> | undefined,
): ParseResult<unknown> {
  if (!fieldType) return { ok: true, value: input === "" || input == null ? null : input };
  return fieldType.parse(input, editorConfig(column, fieldType));
}

/** Formats a cell value into editable text with the column's field type. */
export function formatEditorValue(
  value: unknown,
  column: ColumnDef | undefined,
  fieldType: FieldType<unknown, unknown> | undefined,
): string {
  if (value == null) return "";
  if (!fieldType) return String(value);
  return fieldType.format(value, editorConfig(column, fieldType));
}

/** True when the edit was started by typing a single printable character (which should replace the content). */
export function isPrintableKey(eventKey: string | null | undefined): eventKey is string {
  return typeof eventKey === "string" && eventKey.length === 1;
}

/**
 * Shared state for text-input editors (text/number): keeps the raw text, reports
 * each successfully parsed value via `onValueChange`, and cancels the edit
 * (`isCancelAfterEnd` → true) while the current text does not parse, so an
 * invalid entry never commits. Esc reports the original value back (the grid
 * cancels the edit itself; this just keeps the reported value honest).
 */
export function useParsedTextEditor<Row extends GridRow>(props: SchemaCellEditorProps<Row>) {
  const { schemaColumn, fieldType, eventKey } = props;
  const startedByTyping = isPrintableKey(eventKey);
  const [text, setText] = useState<string>(() =>
    startedByTyping ? eventKey : formatEditorValue(props.value, schemaColumn, fieldType),
  );
  const invalidRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const apply = (next: string): void => {
    setText(next);
    const result = parseEditorInput(next, schemaColumn, fieldType);
    invalidRef.current = !result.ok;
    if (result.ok) props.onValueChange(result.value);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — seed the value from the start key once.
  useEffect(() => {
    if (startedByTyping) apply(eventKey);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (startedByTyping) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    } else {
      el.select();
    }
  }, []);

  useGridCellEditor({ isCancelAfterEnd: () => invalidRef.current });

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === "Escape") {
      invalidRef.current = false;
      props.onValueChange(props.initialValue);
    }
  };

  return { text, apply, inputRef, onKeyDown, invalidRef };
}

/** Inline single-line editor for text, url, email and phone. */
export function TextEditor<Row extends GridRow = GridRow>(props: SchemaCellEditorProps<Row>): JSX.Element {
  const { text, apply, inputRef, onKeyDown } = useParsedTextEditor(props);
  return (
    <input
      ref={(el) => {
        inputRef.current = el;
      }}
      className="sg-cell-editor sg-text-editor"
      type="text"
      aria-label={props.schemaColumn?.label}
      value={text}
      onChange={(e) => apply(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
