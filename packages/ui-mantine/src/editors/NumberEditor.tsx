import { NumberInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";
import { numberInputError, useBlockInvalidEnter, useSurfaceInputProps, useTouchedError } from "./fieldValidation";

export interface NumberEditorConfig {
  precision?: number;
  min?: number;
  max?: number;
}

const toNumber = (next: number | string): number | null => (next === "" ? null : Number(next));

/**
 * Numeric editor respecting the config's precision, min and max. Empty input
 * emits null. An out-of-range value shows an inline message once typed (or
 * on Enter) instead of being silently clamped, and Enter keeps the editor
 * open until it is fixed.
 */
export function NumberEditor({ value, onChange, onCommit, onCancel, column, config, autoFocus, error, surface }: UiEditorProps<number, NumberEditorConfig>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<number | null>(value ?? null);
  const problem = numberInputError(current, config);
  const validation = useTouchedError(problem, error);
  useBlockInvalidEnter(inputRef, problem !== undefined, validation.touch);
  const { props: surfaceProps, extra } = useSurfaceInputProps(surface, validation.visible);

  useEffect(() => {
    if (autoFocus !== false) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <>
      <NumberInput
        ref={inputRef}
        value={value ?? ""}
        aria-label={column.label || undefined}
        {...surfaceProps}
        hideControls
        clampBehavior="none"
        decimalScale={config?.precision}
        styles={{ ...surfaceProps.styles, input: { ...surfaceProps.styles?.input, fontVariantNumeric: "tabular-nums" } }}
        onChange={(next) => {
          const n = toNumber(next);
          setCurrent(n);
          validation.touch();
          onChange(n);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (problem) validation.touch();
            else onCommit();
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
