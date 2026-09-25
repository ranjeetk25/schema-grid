import { Text } from "@mantine/core";
import { createDefaultRegistry, isFormulaError } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";

let formulaType: ReturnType<ReturnType<typeof createDefaultRegistry>["get"]> | undefined;
const getFormulaType = () => {
  formulaType ??= createDefaultRegistry().get("formula");
  return formulaType;
};

/**
 * Read-only formula result, formatted by core's formula field type (which
 * delegates to `config.resultType`). A core `FormulaError` value renders a
 * muted `#ERROR` marker with the message as its title. Never an input.
 */
export function FormulaRenderer({ value, config }: UiRendererProps<unknown, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  if (isFormulaError(value)) {
    return (
      <Text c="dimmed" span title={value.message}>
        #ERROR
      </Text>
    );
  }
  const text = getFormulaType()?.format(value, config) ?? String(value);
  return <span>{text}</span>;
}
