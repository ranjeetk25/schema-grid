import { useRef, useState } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { gridInputClasses, inputClasses } from "./EditorCard";
import { InputShell } from "./InputShell";
import { isGridMode, useAutoFocus } from "./useEditorKeys";

/** Single-line text editor. Enter commits, Escape cancels. */
export function TextEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error }: UiEditorProps<string, unknown>) {
  const [text, setText] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const gridMode = isGridMode(autoFocus);
  useAutoFocus(inputRef, autoFocus);

  return (
    <InputShell gridMode={gridMode} message={error}>
      {({ messageId, invalid }) => (
        <input
          ref={inputRef}
          type="text"
          value={text}
          aria-label={column.label || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={messageId}
          className={cn(gridMode ? gridInputClasses : inputClasses)}
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
      )}
    </InputShell>
  );
}
