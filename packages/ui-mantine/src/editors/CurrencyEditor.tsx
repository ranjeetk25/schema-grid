import { NumberInput } from "@mantine/core";
import { useEffect, useRef } from "react";
import { currencySymbol } from "../internal/core-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";

/** Core `CurrencyConfig` (partial: persisted config overlays core's defaults). */
export interface CurrencyEditorConfig {
  currencyCode?: string;
  locale?: string;
  precision?: number;
  min?: number;
  max?: number;
}

/** Numeric editor with a currency prefix and locale-appropriate thousands grouping. */
export function CurrencyEditor({ value, onChange, onCommit, onCancel, config, autoFocus, error }: UiEditorProps<number, CurrencyEditorConfig>) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Same defaults as core's currency field type.
  const currencyCode = config.currencyCode ?? "INR";
  const locale = config.locale ?? "en-IN";

  useEffect(() => {
    if (autoFocus !== false) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <NumberInput
      ref={inputRef}
      value={value ?? ""}
      error={error}
      prefix={currencySymbol(currencyCode, locale)}
      thousandSeparator
      thousandsGroupStyle={locale === "en-IN" ? "lakh" : "thousand"}
      decimalScale={config.precision ?? 2}
      min={config.min}
      max={config.max}
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
