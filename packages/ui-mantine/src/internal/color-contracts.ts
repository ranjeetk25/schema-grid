/**
 * v0.4 cell colors, ag-grid side: the palette tokens the grid paints with and
 * the capability-aware operator helpers. Kept apart from `grid-contracts.ts`
 * (editor / renderer adapters) so the theme and the filter model can use the
 * palette without pulling the AG Grid React adapters in.
 */
export {
  CELL_COLOR_TOKENS,
  type CellColorCapabilitiesLike,
  type CellColorReport,
  type CellColorTarget,
  type CellColorToken,
  canFilterByColor,
  cellColorCssVariables,
  cellColorVar,
  // v0.4.1: color filtering blocked by a color rule the server can't evaluate.
  type ColorRulesInput,
  colorFilterBlockedReason,
  columnOperatorsWithColors,
  withColorOperators,
} from "@ranjeetk25/schema-grid-ag-grid";
