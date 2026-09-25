import {
  type CSSVariablesResolver,
  type MantineTheme,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useMemo } from "react";

export type GridCssVariables = Record<`--ag-${string}`, string>;

export interface GridThemeParams {
  backgroundColor: string;
  foregroundColor: string;
  borderColor: string;
  accentColor: string;
  headerBackgroundColor: string;
  rowHoverColor: string;
  selectedRowBackgroundColor: string;
  rangeSelectionBorderColor: string;
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

export function resolveGridThemeParams(theme: MantineTheme, scheme: "light" | "dark"): GridThemeParams {
  const primary = theme.colors[theme.primaryColor] ?? theme.colors.blue;
  const accent = primary?.[shade(theme, scheme)] ?? "#228be6";
  const dark = scheme === "dark";
  return {
    backgroundColor: dark ? (theme.colors.dark[7] as string) : theme.white,
    foregroundColor: dark ? (theme.colors.dark[0] as string) : theme.black,
    borderColor: dark ? (theme.colors.dark[4] as string) : (theme.colors.gray[3] as string),
    accentColor: accent,
    headerBackgroundColor: dark ? (theme.colors.dark[6] as string) : (theme.colors.gray[0] as string),
    rowHoverColor: dark ? (theme.colors.dark[5] as string) : (theme.colors.gray[1] as string),
    selectedRowBackgroundColor: (primary?.[dark ? 9 : 0] as string) ?? accent,
    rangeSelectionBorderColor: accent,
    fontFamily: theme.fontFamily ?? "sans-serif",
    fontSize: pxNumber(theme.fontSizes.sm, 14),
    browserColorScheme: scheme,
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

/** Provider-level resolver: `<MantineProvider cssVariablesResolver={mantineGridCssVariablesResolver}>`. */
export const mantineGridCssVariablesResolver: CSSVariablesResolver = (theme) => {
  const light = resolveGridThemeParams(theme, "light");
  const dark = resolveGridThemeParams(theme, "dark");
  const perScheme = (p: GridThemeParams) => ({
    "--ag-header-background-color": p.headerBackgroundColor,
    "--ag-row-hover-color": p.rowHoverColor,
    "--ag-selected-row-background-color": p.selectedRowBackgroundColor,
  });
  const shared = gridCssVariables(theme.primaryColor);
  const {
    "--ag-header-background-color": _h,
    "--ag-row-hover-color": _r,
    "--ag-selected-row-background-color": _s,
    ...variables
  } = shared;
  return { variables, light: perScheme(light), dark: perScheme(dark) };
};
