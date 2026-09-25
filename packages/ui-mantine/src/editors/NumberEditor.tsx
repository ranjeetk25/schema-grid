import { NumberInput } from "@mantine/core";
import { useEffect, useRef } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";

export interface NumberEditorConfig {
  precision?: number;
  min?: number;
  max?: number;
}

/** Numeric editor respecting the config's precision, min and max. Empty input emits null. */
export function NumberEditor({ value, onChange, onCommit, onCancel, config, autoFocus, error }: UiEditorProps<number, NumberEditorConfig>) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus !== false) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <NumberInput
      ref={inputRef}
      value={value ?? ""}
      error={error}
      min={config?.min}
      max={config?.max}
      decimalScale={config?.precision}
      onChange={(next) => {
        onChange(next === "" ? null : Number(next));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}
