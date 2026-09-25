import { useEffect, useRef, useState } from "react";
import type { SuppressKeyboardEventParams } from "ag-grid-community";
import type { GridRow } from "../internal/core";
import { createPopupEditor, type PopupEditorInnerProps } from "./createPopupEditor";
import { formatEditorValue, isPrintableKey, parseEditorInput } from "./TextEditor";

/**
 * `colDef.suppressKeyboardEvent` for longText columns: while editing, Shift+Enter
 * is suppressed so the grid doesn't stop editing and the textarea inserts a
 * newline; plain Enter still reaches the grid and commits. The editor also
 * stops propagation of Shift+Enter itself, so this is belt-and-braces for the
 * grid's popup keydown forwarding. Wire it in `compileColumns` for columns whose
 * editor is `LongTextEditor`: `def.suppressKeyboardEvent = longTextSuppressKeyboardEvent`.
 */
export function longTextSuppressKeyboardEvent<Row extends GridRow = GridRow>(params: SuppressKeyboardEventParams<Row>): boolean {
  return params.editing && params.event.key === "Enter" && params.event.shiftKey;
}

function LongTextInner(props: PopupEditorInnerProps<GridRow, string>): JSX.Element {
  const { schemaColumn, fieldType, editorProps } = props;
  const startedByTyping = isPrintableKey(editorProps.eventKey);
  const [text, setText] = useState<string>(() =>
    startedByTyping ? (editorProps.eventKey as string) : formatEditorValue(props.value, schemaColumn, fieldType),
  );
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const parse = (next: string): string | null => {
    const result = parseEditorInput(next, schemaColumn, fieldType);
    return result.ok ? (result.value as string | null) : next;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only.
  useEffect(() => {
    if (startedByTyping) props.onChange(parse(text));
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  return (
    <textarea
      ref={ref}
      className="sg-cell-editor sg-long-text-editor"
      aria-label={schemaColumn?.label}
      rows={5}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        props.onChange(parse(e.target.value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.cancel();
          return;
        }
        if (e.key !== "Enter") return;
        // Shift+Enter: newline, keep the grid out of it. Enter: commit.
        e.stopPropagation();
        if (e.shiftKey) return;
        e.preventDefault();
        props.commit(parse(text));
      }}
    />
  );
}

const longTextPopup = createPopupEditor<string>(LongTextInner, { position: "under" });

/** Popup textarea editor for longText: Enter commits, Shift+Enter inserts a newline, Esc cancels. */
export const LongTextEditor = longTextPopup.component;
