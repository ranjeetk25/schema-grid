import { Text } from "@mantine/core";
import type { UiRendererProps } from "../internal/grid-contracts";

interface FormulaErrorValue {
  kind: "error";
  message: string;
}

const isFormulaErrorValue = (v: unknown): v is FormulaErrorValue =>
  !!v && typeof v === "object" && (v as { kind?: unknown }).kind === "error";

/** Read-only formula result: plain text for numbers/booleans/strings, a muted marker on `{kind:"error"}`. Never an input. */
export function FormulaRenderer({ value }: UiRendererProps<unknown, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  if (isFormulaErrorValue(value)) {
    return (
      <Text c="dimmed" span title={value.message}>
        #ERROR
      </Text>
    );
  }
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number") return <span>{String(Math.round(value * 1e6) / 1e6)}</span>;
  return <span>{String(value)}</span>;
}
