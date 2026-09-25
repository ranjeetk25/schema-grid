import { Textarea } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { useEditorStyles } from "./EditorCard";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

/**
 * Multi-line text editor. Cmd/Ctrl+Enter commits, plain Enter inserts a
 * newline, Escape cancels. In the popup card it is a borderless, auto-growing
 * text area (at least 320px wide) with a muted keyboard hint below.
 */
export function LongTextEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error, surface }: UiEditorProps<string, unknown>) {
  useEditorStyles();
  const [text, setText] = useState(value ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const card = surface === "popup";

  useEffect(() => {
    const el = ref.current;
    if (autoFocus === false || !el) return;
    el.focus();
    // Caret at the end, like a document.
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const field = (
    <Textarea
      ref={ref}
      autosize
      minRows={card ? 4 : 2}
      maxRows={card ? 12 : 8}
      value={text}
      error={error}
      aria-label={column.label || undefined}
      variant={card ? "unstyled" : "default"}
      styles={card ? { input: { padding: "6px 8px", fontSize: 13, lineHeight: 1.5 } } : undefined}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onCommit(text);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
  if (!card) return field;
  return (
    <div style={{ width: "max(var(--sg-ed-width, 320px), 320px)" }}>
      {field}
      <div className="sg-ed-divider" aria-hidden />
      <div className="sg-ed-hint" style={{ fontFamily: "var(--mantine-font-family-monospace)", fontSize: 11 }}>
        {`${isMac() ? "⌘" : "Ctrl"}↵ save · Esc cancel`}
      </div>
    </div>
  );
}

export const LongTextPopupEditor = toPopupGridEditor(LongTextEditor);
