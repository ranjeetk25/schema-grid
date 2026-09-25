import type { UiEditorProps } from "../internal/grid-contracts";
import { NumericInput } from "./NumericInput";

export interface NumberEditorConfig {
  precision?: number;
  min?: number;
  max?: number;
}

/** Numeric editor respecting the config's precision, min and max. Empty input emits null. */
export function NumberEditor({ value, onChange, onCommit, onCancel, column, config, autoFocus, error }: UiEditorProps<number, NumberEditorConfig>) {
  return (
    <NumericInput
      value={value}
      onChange={onChange}
      onCommit={onCommit}
      onCancel={onCancel}
      label={column.label}
      autoFocus={autoFocus}
      error={error}
      precision={config?.precision}
      min={config?.min}
      max={config?.max}
    />
  );
}
