import { TextInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";

/** Single-line text editor. Enter commits, Escape cancels. */
export function TextEditor({ value, onChange, onCommit, onCancel, autoFocus, error }: UiEditorProps<string, unknown>) {
  const [text, setText] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus !== false) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <TextInput
      ref={inputRef}
      value={text}
      error={error}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
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
