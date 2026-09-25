import { useEffect, useMemo, useRef, useState } from "react";
import { type SchemaGridThemeOverrides, createSchemaGridTheme } from "../internal/grid-contracts";

export type GridColorScheme = "light" | "dark";

/** The `--sg-*` variables `@masai/schema-grid-ag-grid`'s theme reads. */
export type GridCssVariables = Record<`--sg-${string}`, string>;

export interface GridThemeParams {
  backgroundColor: string;
  foregroundColor: string;
  mutedForegroundColor: string;
  borderColor: string;
  accentColor: string;
  headerBackgroundColor: string;
  headerForegroundColor: string;
  rowHoverColor: string;
  selectedRowBackgroundColor: string;
  rangeSelectionBorderColor: string;
  dangerColor: string;
  fontFamily: string;
  fontSize: number;
  browserColorScheme: GridColorScheme;
}

export interface UseGridThemeFromShadcnOptions extends SchemaGridThemeOverrides {
  /** Element whose `dark` class selects the scheme; defaults to `document.documentElement`. */
  root?: Element | null;
}

export interface GridThemeFromShadcn {
  /** `createSchemaGridTheme(overrides)` + `browserColorScheme`; stable per scheme/options. */
  theme: ReturnType<typeof createSchemaGridTheme>;
  scheme: GridColorScheme;
  /** Resolved colours for hosts that need raw values (charts, canvas, emails). */
  params: GridThemeParams;
}

/**
 * The grid theme contract mapped onto the kit tokens (mirrors the block at
 * the bottom of `styles/tokens.css`). Already applied by the stylesheet; use
 * it to scope the contract onto a custom container via `style`.
 */
export const shadcnGridCssVariables: Readonly<GridCssVariables> = Object.freeze({
  "--sg-accent-color": "var(--sg-ui-primary)",
  "--sg-background-color": "var(--sg-ui-background)",
  "--sg-foreground-color": "var(--sg-ui-foreground)",
  "--sg-muted-foreground-color": "var(--sg-ui-muted-foreground)",
  "--sg-border-color": "var(--sg-ui-border)",
  "--sg-header-background-color": "var(--sg-ui-subtle)",
  "--sg-header-foreground-color": "var(--sg-ui-muted-foreground)",
  "--sg-row-hover-color": "color-mix(in srgb, var(--sg-ui-foreground) 3%, transparent)",
  "--sg-selected-row-background-color": "var(--sg-ui-primary-subtle)",
  "--sg-range-bg": "color-mix(in srgb, var(--sg-ui-primary) 10%, transparent)",
  "--sg-range-border": "var(--sg-ui-primary)",
  "--sg-danger-color": "var(--sg-ui-danger)",
  "--sg-popup-shadow": "var(--sg-ui-shadow-popover)",
  "--sg-font-family": "var(--sg-ui-font)",
  "--sg-font-size": "13px",
});

const FONT = '"Geist", "Geist Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif';

/** Static token values (mirror `styles/tokens.css`). */
const TOKENS: Record<GridColorScheme, Omit<GridThemeParams, "browserColorScheme">> = {
  light: {
    backgroundColor: "#ffffff",
    foregroundColor: "#09090b",
    mutedForegroundColor: "#71717a",
    borderColor: "#e4e4e7",
    accentColor: "#5e6ad2",
    headerBackgroundColor: "#fafafa",
    headerForegroundColor: "#71717a",
    rowHoverColor: "rgb(9 9 11 / 0.03)",
    selectedRowBackgroundColor: "rgb(94 106 210 / 0.1)",
    rangeSelectionBorderColor: "#5e6ad2",
    dangerColor: "#dc2626",
    fontFamily: FONT,
    fontSize: 13,
  },
  dark: {
    backgroundColor: "#18181b",
    foregroundColor: "#e4e4e7",
    mutedForegroundColor: "#a1a1aa",
    borderColor: "#2e2e33",
    accentColor: "#7c86dc",
    headerBackgroundColor: "#1f1f23",
    headerForegroundColor: "#a1a1aa",
    rowHoverColor: "rgb(228 228 231 / 0.03)",
    selectedRowBackgroundColor: "rgb(124 134 220 / 0.16)",
    rangeSelectionBorderColor: "#7c86dc",
    dangerColor: "#f87171",
    fontFamily: FONT,
    fontSize: 13,
  },
};

/** The static light/dark token values, for SSR or hosts without the stylesheet. */
export function resolveGridThemeParams(scheme: GridColorScheme): GridThemeParams {
  return { ...TOKENS[scheme], browserColorScheme: scheme };
}

/** Kit token each resolved param is read from (computed style), when the host defines it. */
const TOKEN_SOURCES: Partial<Record<keyof GridThemeParams, string>> = {
  backgroundColor: "--sg-ui-background",
  foregroundColor: "--sg-ui-foreground",
  mutedForegroundColor: "--sg-ui-muted-foreground",
  borderColor: "--sg-ui-border",
  accentColor: "--sg-ui-primary",
  headerBackgroundColor: "--sg-ui-subtle",
  headerForegroundColor: "--sg-ui-muted-foreground",
  selectedRowBackgroundColor: "--sg-ui-primary-subtle",
  rangeSelectionBorderColor: "--sg-ui-primary",
  dangerColor: "--sg-ui-danger",
  fontFamily: "--sg-ui-font",
};

function readParams(el: Element | null, scheme: GridColorScheme, overrides: SchemaGridThemeOverrides): GridThemeParams {
  const params = resolveGridThemeParams(scheme);
  const style = el && typeof window !== "undefined" ? window.getComputedStyle(el) : null;
  if (style) {
    for (const [key, token] of Object.entries(TOKEN_SOURCES) as [keyof GridThemeParams, string][]) {
      const value = style.getPropertyValue(token).trim();
      if (value) (params as unknown as Record<string, string>)[key] = value;
    }
  }
  if (overrides.accentColor) {
    params.accentColor = overrides.accentColor;
    params.rangeSelectionBorderColor = overrides.accentColor;
  }
  if (overrides.backgroundColor) params.backgroundColor = overrides.backgroundColor;
  if (overrides.foregroundColor) params.foregroundColor = overrides.foregroundColor;
  if (overrides.borderColor) params.borderColor = overrides.borderColor;
  if (overrides.headerBackgroundColor) params.headerBackgroundColor = overrides.headerBackgroundColor;
  if (overrides.fontFamily) params.fontFamily = overrides.fontFamily;
  if (typeof overrides.fontSize === "number") params.fontSize = overrides.fontSize;
  return params;
}

const schemeOf = (el: Element | null): GridColorScheme => (el?.classList.contains("dark") ? "dark" : "light");

function defaultRoot(root: Element | null | undefined): Element | null {
  if (root !== undefined) return root;
  return typeof document === "undefined" ? null : document.documentElement;
}

/**
 * Bridges the kit's tokens + `.dark` class to AG Grid theming. The theme's
 * colours stay the `--sg-*` CSS variables (so it follows token overrides and
 * `.dark` live, without re-creating the theme); `scheme` tracks the `dark`
 * class on `<html>` (or `options.root`) with a MutationObserver.
 */
export function useGridThemeFromShadcn(options: UseGridThemeFromShadcnOptions = {}): GridThemeFromShadcn {
  const { root: rootOption, accentColor, backgroundColor, foregroundColor, borderColor, headerBackgroundColor, fontFamily, fontSize, rowHeight } =
    options;
  const root = defaultRoot(rootOption);
  const [scheme, setScheme] = useState<GridColorScheme>(() => schemeOf(root));

  useEffect(() => {
    setScheme(schemeOf(root));
    if (!root || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setScheme(schemeOf(root)));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [root]);

  const overrides = useMemo<SchemaGridThemeOverrides>(() => {
    const out: SchemaGridThemeOverrides = {};
    if (accentColor !== undefined) out.accentColor = accentColor;
    if (backgroundColor !== undefined) out.backgroundColor = backgroundColor;
    if (foregroundColor !== undefined) out.foregroundColor = foregroundColor;
    if (borderColor !== undefined) out.borderColor = borderColor;
    if (headerBackgroundColor !== undefined) out.headerBackgroundColor = headerBackgroundColor;
    if (fontFamily !== undefined) out.fontFamily = fontFamily;
    if (fontSize !== undefined) out.fontSize = fontSize;
    if (rowHeight !== undefined) out.rowHeight = rowHeight;
    return out;
  }, [accentColor, backgroundColor, foregroundColor, borderColor, headerBackgroundColor, fontFamily, fontSize, rowHeight]);

  // One theme per scheme for the current overrides, so toggling back returns the same object.
  const cache = useRef<{ overrides: SchemaGridThemeOverrides; themes: Partial<Record<GridColorScheme, GridThemeFromShadcn["theme"]>> }>({
    overrides,
    themes: {},
  });
  if (cache.current.overrides !== overrides) cache.current = { overrides, themes: {} };
  let theme = cache.current.themes[scheme];
  if (!theme) {
    theme = createSchemaGridTheme(overrides).withParams({ browserColorScheme: scheme });
    cache.current.themes[scheme] = theme;
  }

  return useMemo(() => ({ theme, scheme, params: readParams(root, scheme, overrides) }), [theme, scheme, root, overrides]);
}
