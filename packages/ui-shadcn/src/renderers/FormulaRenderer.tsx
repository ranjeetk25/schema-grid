import { createDefaultRegistry, isFormulaError } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Tooltip } from "../ui/tooltip";

let formulaType: ReturnType<ReturnType<typeof createDefaultRegistry>["get"]> | undefined;
const getFormulaType = () => {
  formulaType ??= createDefaultRegistry().get("formula");
  return formulaType;
};

const NUMERIC_RESULTS = new Set(["number", "currency"]);

/**
 * Read-only formula result, formatted by core's formula field type (which
 * delegates to `config.resultType`): muted text behind a muted `ƒ` glyph,
 * with a "Formula · {expression}" tooltip. A core `FormulaError` renders a
 * muted `#ERROR` with the message as its title. Never an input, never a
 * pointer cursor.
 */
export function FormulaRenderer({ value, column, config }: UiRendererProps<unknown, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  if (isFormulaError(value)) {
    return (
      <span title={value.message} className={cn(SG_ROOT, "sg:inline-flex sg:cursor-default sg:items-center sg:gap-1 sg:font-mono sg:text-xs sg:text-faint-foreground")}>
        #ERROR
      </span>
    );
  }
  const text = getFormulaType()?.format(value, config) ?? String(value);
  const resultType = (config as { resultType?: string } | null | undefined)?.resultType;
  const body = (
    <span
      className={cn(
        SG_ROOT,
        "sg:flex sg:min-w-0 sg:cursor-default sg:items-baseline sg:gap-1.5 sg:text-muted-foreground sg:tabular-nums",
        resultType && NUMERIC_RESULTS.has(resultType) && "sg:justify-end",
      )}
    >
      <span aria-hidden className="sg:shrink-0 sg:font-serif sg:text-xs sg:italic sg:text-faint-foreground sg:select-none">
        ƒ
      </span>
      <span className="sg:truncate">{text}</span>
    </span>
  );
  const expression = column.formula?.trim();
  return expression ? <Tooltip content={`Formula · ${expression}`}>{body}</Tooltip> : body;
}
