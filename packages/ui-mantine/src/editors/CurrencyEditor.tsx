import { NumberInput } from "@mantine/core";
import { useEffect, useRef } from "react";
import { currencySymbol } from "../internal/core-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";

export interface CurrencyEditorConfig {
  currency: string;
  locale: string;
  decimalScale: number;
  fixedDecimalScale: boolean;
}

/** Numeric editor with a currency prefix and locale-appropriate thousands grouping. */
export function CurrencyEditor({ value, onChange, onCommit, onCancel, config, autoFocus, error }: UiEditorProps<number, CurrencyEditorConfig>) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus !== false) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <NumberInput
      ref={inputRef}
      value={value ?? ""}
      error={error}
      prefix={currencySymbol(config.currency, config.locale)}
      thousandSeparator
      thousandsGroupStyle={config.locale === "en-IN" ? "lakh" : "thousand"}
      decimalScale={config.decimalScale}
      fixedDecimalScale={config.fixedDecimalScale}
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
