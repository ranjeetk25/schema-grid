import { TextInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";
import { textInputError, useBlockInvalidEnter, useSurfaceInputProps, useTouchedError } from "./fieldValidation";

/**
 * Single-line text editor. Enter commits, Escape cancels. Core's text
 * `parse` (min/max length) is checked as you type; the message shows once
 * you have typed or pressed Enter, and Enter on an invalid value keeps the
 * editor open.
 */
export function TextEditor({ value, onChange, onCommit, onCancel, column, config, autoFocus, error, surface }: UiEditorProps<string, unknown>) {
  const [text, setText] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const problem = textInputError("text", text, config);
  const validation = useTouchedError(problem, error);
  useBlockInvalidEnter(inputRef, problem !== undefined, validation.touch);
  const { props: surfaceProps, extra } = useSurfaceInputProps(surface, validation.visible);

  useEffect(() => {
    if (autoFocus !== false) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <>
      <TextInput
        ref={inputRef}
        value={text}
        aria-label={column.label || undefined}
        {...surfaceProps}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          validation.touch();
          onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (problem) validation.touch();
            else onCommit(text);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {extra}
    </>
  );
}
