// v0.4 cell colors: palette, color rules, manual color writes and resolution.
import type { FilterMatchContext } from "../filter/match";

export {
  CELL_COLORS,
  isCellColor,
  type CellColor,
  type CellColorBatch,
  type CellColorChange,
  type CellColorResult,
  type ColorRule,
  type ColorRuleTarget,
} from "./types";
export { resolveCellColor, resolveRowColor } from "../filter/match";
export { type ColorRuleIssue, type ColorRulesValidation, validateColorRules } from "./validate";
export { canColorCell } from "./access";

/** Context for `resolveCellColor` / `resolveRowColor` (the filter match context). */
export type ColorMatchContext = FilterMatchContext;
