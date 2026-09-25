/**
 * Quartz theme, re-parameterised so every color/font/spacing value reads
 * from a `--sg-*` CSS custom property (with the Quartz default as fallback),
 * plus our own cell/row decoration CSS injected via the Theming API's
 * CSS-part mechanism (`createPart`, verified against
 * node_modules/ag-stack/dist/types/src/theming/{part,partImpl}.d.ts for
 * ag-grid-community 36.2 — `createPart({ feature, css })` + `theme.withPart(part)`
 * are both present, and `css` accepts a raw string).
 *
 * No global stylesheet is shipped: the grid injects `SG_THEME_CSS` itself,
 * scoped by AG Grid to the grid's themed root, only while a grid using this
 * theme is mounted.
 */
import { createPart, themeQuartz } from "ag-grid-community";
import type { Theme } from "ag-grid-community";
import { SG_THEME_CSS } from "./classNames";

/**
 * Overridable Quartz params. Kept to the subset the plan calls out
 * (accentColor, backgroundColor, foregroundColor, borderColor,
 * headerBackgroundColor, fontFamily, fontSize) plus rowHeight, since AG Grid
 * itself supports overriding it and callers reasonably expect to.
 */
export interface SchemaGridThemeOverrides {
  accentColor?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  borderColor?: string;
  headerBackgroundColor?: string;
  fontFamily?: string;
  fontSize?: string | number;
  rowHeight?: string | number;
}

const schemaGridPart = createPart({
  feature: "schemaGrid",
  css: SG_THEME_CSS,
});

export function createSchemaGridTheme(overrides: SchemaGridThemeOverrides = {}): Theme {
  return themeQuartz
    .withParams({
      accentColor: overrides.accentColor ?? "var(--sg-accent-color, #2185d0)",
      backgroundColor: overrides.backgroundColor ?? "var(--sg-background-color, #ffffff)",
      foregroundColor: overrides.foregroundColor ?? "var(--sg-foreground-color, #182230)",
      borderColor: overrides.borderColor ?? "var(--sg-border-color, #dee2e6)",
      headerBackgroundColor: overrides.headerBackgroundColor ?? "var(--sg-header-background-color, #f8f9fa)",
      fontFamily: overrides.fontFamily ?? "var(--sg-font-family, inherit)",
      ...(overrides.fontSize !== undefined ? { fontSize: overrides.fontSize } : { fontSize: "var(--sg-font-size, 13px)" }),
      ...(overrides.rowHeight !== undefined ? { rowHeight: overrides.rowHeight } : {}),
    })
    .withPart(schemaGridPart);
}
