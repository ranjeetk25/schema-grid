import { Tooltip } from "@mantine/core";
import { createDefaultRegistry, isFormulaError } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { useEditorStyles } from "../editors/EditorCard";
import { CellBox } from "./CellBox";

let formulaType: ReturnType<ReturnType<typeof createDefaultRegistry>["get"]> | undefined;
const getFormulaType = () => {
  formulaType ??= createDefaultRegistry().get("formula");
  return formulaType;
};

const NUMERIC_RESULTS = new Set(["number", "currency"]);

/** The `ƒ` prefix, drawn by CSS (`::before`) so it never becomes part of the cell's text / copy value. */
function Glyph() {
  useEditorStyles();
  return <span aria-hidden className="sg-formula-glyph" data-testid="formula-glyph" />;
}

/**
 * Read-only formula result, formatted by core's formula field type (which
 * delegates to `config.resultType`), in muted text with a small `ƒ` glyph and
 * a "Formula · <expression>" tooltip. A core `FormulaError` value renders a
 * muted `#ERROR` marker with the message as its title. Never an input.
 */
export function FormulaRenderer({ value, column, config }: UiRendererProps<unknown, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  const expression = column.formula?.trim();
  const resultType = (config as { resultType?: unknown } | null)?.resultType;
  const content = isFormulaError(value) ? (
    <CellBox style={{ color: "var(--mantine-color-dimmed)", cursor: "default" }}>
      <Glyph />
      <span title={value.message}>#ERROR</span>
    </CellBox>
  ) : (
    <CellBox
      style={{
        color: "var(--mantine-color-dimmed)",
        cursor: "default",
        fontVariantNumeric: typeof resultType === "string" && NUMERIC_RESULTS.has(resultType) ? "tabular-nums" : undefined,
      }}
    >
      <Glyph />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{getFormulaType()?.format(value, config) ?? String(value)}</span>
    </CellBox>
  );
  if (!expression) return content;
  return (
    <Tooltip label={`Formula · ${expression}`} openDelay={500} withinPortal>
      {content}
    </Tooltip>
  );
}
