import { currencySymbol } from "../internal/core-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { NumericInput } from "./NumericInput";

/** Core `CurrencyConfig` (partial: persisted config overlays core's defaults). */
export interface CurrencyEditorConfig {
  currencyCode?: string;
  locale?: string;
  precision?: number;
  min?: number;
  max?: number;
}

/** Numeric editor with a currency-symbol adornment and locale-appropriate grouping (lakh for en-IN). */
export function CurrencyEditor({ value, onChange, onCommit, onCancel, column, config, autoFocus, error }: UiEditorProps<number, CurrencyEditorConfig>) {
  // Same defaults as core's currency field type.
  const currencyCode = config?.currencyCode ?? "INR";
  const locale = config?.locale ?? "en-IN";
  return (
    <NumericInput
      value={value}
      onChange={onChange}
      onCommit={onCommit}
      onCancel={onCancel}
      label={column.label}
      autoFocus={autoFocus}
      error={error}
      precision={config?.precision ?? 2}
      min={config?.min}
      max={config?.max}
      grouping
      locale={locale}
      prefix={currencySymbol(currencyCode, locale)}
    />
  );
}
