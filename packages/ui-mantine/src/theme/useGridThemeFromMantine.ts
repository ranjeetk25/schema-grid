import {
  type CSSVariablesResolver,
  type MantineTheme,
  alpha,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useMemo } from "react";
import { schemaGridMantineVariables } from "./schemaGridMantineTheme";

export type GridCssVariables = Record<`--ag-${string}`, string>;

/** The `--sg-*` contract `@ranjeetk25/schema-grid-ag-grid`'s theme reads (docs/design/README.md). */
export type SchemaGridCssVariables = Record<`--sg-${string}`, string>;

export interface GridThemeParams {
  backgroundColor: string;
  foregroundColor: string;
  /** Header labels, helper text, icons. */
  mutedForegroundColor: string;
  borderColor: string;
  accentColor: string;
  headerBackgroundColor: string;
  headerForegroundColor: string;
  rowHoverColor: string;
  /** Accent at ~8% alpha. */
  selectedRowBackgroundColor: string;
  /** Accent at ~10% alpha. */
  rangeSelectionBackgroundColor: string;
  rangeSelectionBorderColor: string;
  dangerColor: string;
  fontFamily: string;
  fontSize: number;
  browserColorScheme: "light" | "dark";
}

export interface GridThemeFromMantine {
  colorScheme: "light" | "dark";
  /** AG Grid CSS variables that reference Mantine variables (follow light/dark automatically). */
  cssVariables: GridCssVariables;
  /** Resolved values for `themeQuartz.withParams(params)`. */
  params: GridThemeParams;
}

/** Scheme-independent mappings (Mantine's own variables already switch with the scheme). */
export function gridCssVariables(primaryColor: string): GridCssVariables {
  return {
    "--ag-background-color": "var(--mantine-color-body)",
    "--ag-foreground-color": "var(--mantine-color-text)",
    "--ag-border-color": "var(--mantine-color-default-border)",
    "--ag-accent-color": `var(--mantine-color-${primaryColor}-filled)`,
    "--ag-header-background-color": "var(--mantine-color-default-hover)",
    "--ag-row-hover-color": `var(--mantine-color-${primaryColor}-light-hover)`,
    "--ag-selected-row-background-color": `var(--mantine-color-${primaryColor}-light)`,
    "--ag-range-selection-border-color": `var(--mantine-color-${primaryColor}-filled)`,
    "--ag-font-family": "var(--mantine-font-family)",
    "--ag-font-size": "var(--mantine-font-size-sm)",
  };
}

const shade = (theme: MantineTheme, scheme: "light" | "dark"): number => {
  const s = theme.primaryShade;
  return typeof s === "number" ? s : s[scheme];
};

const pxNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const rem = /^calc\(([\d.]+)rem/.exec(value) ?? /^([\d.]+)rem$/.exec(value);
  if (rem?.[1]) return Number(rem[1]) * 16;
  const px = /^([\d.]+)px$/.exec(value);
  return px?.[1] ? Number(px[1]) : fallback;
};

/** Danger per README (red-600 / red-400); not taken from Mantine's brighter `red`. */
const DANGER = { light: "#dc2626", dark: "#f87171" } as const;
/** Grid chrome is 13px regardless of the host's `fontSizes.sm`. */
export const SG_GRID_FONT_SIZE = 13;

const pick = (tuple: readonly string[] | undefined, i: number, fallback: string): string => tuple?.[i] ?? fallback;

/**
 * Resolved grid colours for one scheme. Neutrals come from the Mantine
 * palette (`gray` light end, `dark` for dark mode — exactly the README zinc
 * tokens under `schemaGridMantineTheme`); the accent is the primary colour at
 * `primaryShade`; selection/range tints are the accent at 8% / 10% alpha.
 */
export function resolveGridThemeParams(theme: MantineTheme, scheme: "light" | "dark"): GridThemeParams {
  const primary = theme.colors[theme.primaryColor] ?? theme.colors.blue;
  const accent = primary?.[shade(theme, scheme)] ?? "#5e6ad2";
  const dark = scheme === "dark";
  const gray = theme.colors.gray;
  const darks = theme.colors.dark;
  const muted = dark ? pick(darks, 2, "#a1a1aa") : pick(gray, 5, "#71717a");
  return {
    backgroundColor: dark ? pick(darks, 7, "#18181b") : theme.white,
    foregroundColor: dark ? pick(darks, 0, "#e4e4e7") : theme.black,
    mutedForegroundColor: muted,
    borderColor: dark ? pick(darks, 4, "#2e2e33") : pick(gray, 2, "#e4e4e7"),
    accentColor: accent,
    headerBackgroundColor: dark ? pick(darks, 6, "#1f1f23") : pick(gray, 0, "#fafafa"),
    headerForegroundColor: muted,
    rowHoverColor: dark ? "rgba(255, 255, 255, 0.03)" : "rgba(9, 9, 11, 0.025)",
    selectedRowBackgroundColor: alpha(accent, dark ? 0.14 : 0.08),
    rangeSelectionBackgroundColor: alpha(accent, dark ? 0.16 : 0.1),
    rangeSelectionBorderColor: accent,
    dangerColor: DANGER[scheme],
    fontFamily: theme.fontFamily ?? "sans-serif",
    fontSize: SG_GRID_FONT_SIZE,
    browserColorScheme: scheme,
  };
}

/** The per-scheme `--sg-*` values (plus the scheme-independent font variables). */
export function schemaGridCssVariables(params: GridThemeParams, scheme: "light" | "dark"): SchemaGridCssVariables {
  return {
    "--sg-accent-color": params.accentColor,
    "--sg-background-color": params.backgroundColor,
    "--sg-foreground-color": params.foregroundColor,
    "--sg-muted-foreground-color": params.mutedForegroundColor,
    "--sg-border-color": params.borderColor,
    "--sg-header-background-color": params.headerBackgroundColor,
    "--sg-header-foreground-color": params.headerForegroundColor,
    "--sg-row-hover-color": params.rowHoverColor,
    "--sg-selected-row-background-color": params.selectedRowBackgroundColor,
    "--sg-range-bg": params.rangeSelectionBackgroundColor,
    "--sg-range-border": params.rangeSelectionBorderColor,
    "--sg-popup-shadow": `var(--sg-popup-shadow-${scheme})`,
    "--sg-danger-color": params.dangerColor,
  };
}

/** Bridges the current Mantine theme + colour scheme to AG Grid theming inputs. */
export function useGridThemeFromMantine(): GridThemeFromMantine {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("light");
  return useMemo(
    () => ({
      colorScheme,
      cssVariables: gridCssVariables(theme.primaryColor),
      params: resolveGridThemeParams(theme, colorScheme),
    }),
    [theme, colorScheme],
  );
}

/**
 * Provider-level resolver:
 * `<MantineProvider theme={schemaGridMantineTheme} cssVariablesResolver={mantineGridCssVariablesResolver}>`.
 *
 * Emits (1) `schemaGridMantineVariables` (zinc retune of Mantine's own
 * defaults + popup shadows), (2) the `--sg-*` grid contract per scheme with
 * the accent = Mantine primary colour, and (3) the legacy `--ag-*` mappings.
 */
export const mantineGridCssVariablesResolver: CSSVariablesResolver = (theme) => {
  const light = resolveGridThemeParams(theme, "light");
  const dark = resolveGridThemeParams(theme, "dark");
  const perScheme = (p: GridThemeParams, scheme: "light" | "dark") => ({
    ...schemaGridCssVariables(p, scheme),
    "--ag-header-background-color": p.headerBackgroundColor,
    "--ag-row-hover-color": p.rowHoverColor,
    "--ag-selected-row-background-color": p.selectedRowBackgroundColor,
  });
  const shared = gridCssVariables(theme.primaryColor);
  const {
    "--ag-header-background-color": _h,
    "--ag-row-hover-color": _r,
    "--ag-selected-row-background-color": _s,
    ...agShared
  } = shared;
  const base = schemaGridMantineVariables;
  return {
    variables: {
      ...base.variables,
      ...agShared,
      "--sg-font-family": "var(--mantine-font-family)",
      "--sg-font-size": `${SG_GRID_FONT_SIZE}px`,
    },
    light: { ...base.light, ...perScheme(light, "light") },
    dark: { ...base.dark, ...perScheme(dark, "dark") },
  };
};
