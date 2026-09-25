import { Checkbox } from "@mantine/core";
import { useEffect, useRef } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";

/** Checkbox editor. Toggling (click or space) commits immediately. */
export function BooleanEditor({ value, onChange, onCommit, autoFocus }: UiEditorProps<boolean, unknown>) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus !== false) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <Checkbox
      ref={inputRef}
      checked={value ?? false}
      onChange={(event) => {
        const next = event.currentTarget.checked;
        onChange(next);
        onCommit(next);
      }}
    />
  );
}
