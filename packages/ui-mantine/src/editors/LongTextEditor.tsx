import { Textarea } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";

/** Multi-line text editor. Cmd/Ctrl+Enter commits, plain Enter inserts a newline, Escape cancels. */
export function LongTextEditor({ value, onChange, onCommit, onCancel, autoFocus, error }: UiEditorProps<string, unknown>) {
  const [text, setText] = useState(value ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus !== false) ref.current?.focus();
  }, [autoFocus]);

  return (
    <Textarea
      ref={ref}
      autosize
      value={text}
      error={error}
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
}

export const LongTextPopupEditor = toPopupGridEditor(LongTextEditor);
