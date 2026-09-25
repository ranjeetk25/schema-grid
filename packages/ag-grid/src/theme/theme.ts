/**
 * Quartz theme, re-parameterised to the schema-grid design language
 * (docs/design/README.md: Linear density, Vercel restraint). Every colour,
 * font and shadow reads a `--sg-*` CSS custom property (the contract that
 * ui-mantine's `mantineGridCssVariablesResolver` fills) with the README's
 * light value as fallback, plus our own decoration/chrome CSS injected via
 * the Theming API's CSS-part mechanism (`createPart`, verified against
 * node_modules/ag-stack/dist/types/src/theming/{part,partImpl}.d.ts for
 * ag-grid-community 36.2 — `createPart({ feature, css })` +
 * `theme.withPart(part)` are both present, and `css` accepts a raw string).
 *
 * Param names were checked against ag-grid-community 36.2's
 * `theming/core/core-css.d.ts`, ag-stack's `theming/shared/shared-css.d.ts`
 * and `parts/input-style/input-styles.d.ts`.
 *
 * No global stylesheet is shipped: the grid injects `SG_THEME_CSS` itself,
 * scoped by AG Grid to the grid's themed root, only while a grid using this
 * theme is mounted.
 */
import { createPart, themeQuartz } from "ag-grid-community";
import type { Theme } from "ag-grid-community";
import { SG_THEME_CSS } from "./classNames";

/** Overridable Quartz params (each replaces the `--sg-*`-driven default). */
export interface SchemaGridThemeOverrides {
  accentColor?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  borderColor?: string;
  headerBackgroundColor?: string;
  headerTextColor?: string;
  rowHoverColor?: string;
  selectedRowBackgroundColor?: string;
  fontFamily?: string;
  fontSize?: string | number;
  rowHeight?: string | number;
  headerHeight?: string | number;
  spacing?: string | number;
  wrapperBorderRadius?: string | number;
  borderRadius?: string | number;
}

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif';
const POPUP_SHADOW = "var(--sg-popup-shadow, 0 8px 24px -6px rgb(0 0 0 / .12), 0 0 0 1px rgb(0 0 0 / .06))";
/** 1px hairline in the border colour. */
const HAIRLINE = { style: "solid", width: 1, color: { ref: "borderColor" } } as const;

const schemaGridPart = createPart({
  feature: "schemaGrid",
  css: SG_THEME_CSS,
});

/** The default params, before overrides. Exported for tests/docs. */
export const SCHEMA_GRID_THEME_PARAMS = {
  // Colour roles (README "Colour"): zinc neutrals, one accent.
  accentColor: "var(--sg-accent-color, #5e6ad2)",
  backgroundColor: "var(--sg-background-color, #ffffff)",
  foregroundColor: "var(--sg-foreground-color, #09090b)",
  subtleTextColor: "var(--sg-muted-foreground-color, #71717a)",
  borderColor: "var(--sg-border-color, #e4e4e7)",
  chromeBackgroundColor: "var(--sg-header-background-color, #fafafa)",
  headerBackgroundColor: "var(--sg-header-background-color, #fafafa)",
  headerTextColor: { ref: "foregroundColor" },
  iconColor: "var(--sg-muted-foreground-color, #71717a)",
  invalidColor: "var(--sg-danger-color, #dc2626)",
  rowHoverColor: "var(--sg-row-hover-color, rgba(9, 9, 11, 0.025))",
  selectedRowBackgroundColor: "var(--sg-selected-row-background-color, rgba(94, 106, 210, 0.08))",
  rangeSelectionBackgroundColor: { ref: "accentColor", mix: 0.08 },
  rangeSelectionBorderColor: { ref: "accentColor" },
  oddRowBackgroundColor: { ref: "backgroundColor" },
  headerCellHoverBackgroundColor: "transparent",
  headerColumnResizeHandleColor: { ref: "borderColor" },
  menuBackgroundColor: { ref: "backgroundColor" },

  // Type
  fontFamily: `var(--sg-font-family, ${FONT_STACK})`,
  fontSize: "var(--sg-font-size, 13px)",
  headerFontSize: 13,
  headerFontWeight: 500,

  // Density (README "Heights"): spacing 6 → 12px cell padding.
  spacing: 6,
  rowHeight: 36,
  headerHeight: 36,
  cellHorizontalPadding: 12,
  listItemHeight: 30,
  inputHeight: 30,
  iconSize: 14,

  // Lines: horizontal hairlines only, no vertical rules in body or header.
  borderRadius: 6,
  wrapperBorderRadius: 8,
  wrapperBorder: HAIRLINE,
  rowBorder: HAIRLINE,
  headerRowBorder: HAIRLINE,
  columnBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleHeight: "40%",
  headerColumnResizeHandleWidth: 1,
  menuBorder: HAIRLINE,

  // Elevation only on floating layers; accent focus ring.
  popupShadow: POPUP_SHADOW,
  menuShadow: POPUP_SHADOW,
  dropdownShadow: POPUP_SHADOW,
  cardShadow: POPUP_SHADOW,
  focusShadow: { spread: 2, color: { ref: "accentColor", mix: 0.35 } },
  inputBorder: HAIRLINE,
  inputFocusBorder: { style: "solid", width: 1, color: { ref: "accentColor" } },
  inputFocusShadow: { spread: 2, color: { ref: "accentColor", mix: 0.2 } },
  cellEditingBorder: { style: "solid", width: 1, color: { ref: "accentColor" } },
  cellEditingShadow: false,
} as const;

export function createSchemaGridTheme(overrides: SchemaGridThemeOverrides = {}): Theme {
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return themeQuartz.withParams({ ...SCHEMA_GRID_THEME_PARAMS, ...defined }).withPart(schemaGridPart);
}
