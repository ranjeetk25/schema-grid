import { NumberInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { currencySymbol } from "../internal/core-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { numberInputError, useBlockInvalidEnter, useSurfaceInputProps, useTouchedError } from "./fieldValidation";

/** Core `CurrencyConfig` (partial: persisted config overlays core's defaults). */
export interface CurrencyEditorConfig {
  currencyCode?: string;
  locale?: string;
  precision?: number;
  min?: number;
  max?: number;
}

/**
 * Numeric editor with a currency prefix and locale-appropriate thousands
 * grouping. Out-of-range values show an inline message (after typing or
 * Enter) and Enter keeps the editor open until fixed.
 */
export function CurrencyEditor({ value, onChange, onCommit, onCancel, column, config, autoFocus, error, surface }: UiEditorProps<number, CurrencyEditorConfig>) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Same defaults as core's currency field type.
  const currencyCode = config?.currencyCode ?? "INR";
  const locale = config?.locale ?? "en-IN";
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
        prefix={currencySymbol(currencyCode, locale)}
        thousandSeparator
        thousandsGroupStyle={locale === "en-IN" ? "lakh" : "thousand"}
        decimalScale={config?.precision ?? 2}
        styles={{ ...surfaceProps.styles, input: { ...surfaceProps.styles?.input, fontVariantNumeric: "tabular-nums" } }}
        onChange={(next) => {
          const n = next === "" ? null : Number(next);
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
