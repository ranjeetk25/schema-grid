import { DEFAULT_THEME, createTheme, mergeMantineTheme } from "@mantine/core";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MantineTestWrapper } from "../test/render";
import { mantineGridCssVariablesResolver, useGridThemeFromMantine } from "./useGridThemeFromMantine";

const wrap =
  (props: { theme?: ReturnType<typeof createTheme>; forceColorScheme?: "light" | "dark" } = {}) =>
  ({ children }: { children: ReactNode }) => <MantineTestWrapper {...props}>{children}</MantineTestWrapper>;

describe("useGridThemeFromMantine", () => {
  it("maps AG Grid variables to Mantine CSS variables", () => {
    const { result } = renderHook(() => useGridThemeFromMantine(), { wrapper: wrap() });
    expect(result.current.cssVariables["--ag-background-color"]).toBe("var(--mantine-color-body)");
    expect(result.current.cssVariables["--ag-foreground-color"]).toBe("var(--mantine-color-text)");
    expect(result.current.cssVariables["--ag-font-family"]).toBe("var(--mantine-font-family)");
    expect(result.current.colorScheme).toBe("light");
    expect(result.current.params.backgroundColor).toBe(DEFAULT_THEME.white);
  });

  it("accent follows a custom primaryColor", () => {
    const { result } = renderHook(() => useGridThemeFromMantine(), {
      wrapper: wrap({ theme: createTheme({ primaryColor: "teal" }) }),
    });
    expect(result.current.cssVariables["--ag-accent-color"]).toBe("var(--mantine-color-teal-filled)");
    expect(result.current.params.accentColor).toBe(DEFAULT_THEME.colors.teal[6]);
  });

  it("reflects forceColorScheme dark", () => {
    const { result } = renderHook(() => useGridThemeFromMantine(), { wrapper: wrap({ forceColorScheme: "dark" }) });
    expect(result.current.colorScheme).toBe("dark");
    expect(result.current.params.browserColorScheme).toBe("dark");
    expect(result.current.params.backgroundColor).toBe(DEFAULT_THEME.colors.dark[7]);
  });
});

describe("mantineGridCssVariablesResolver", () => {
  it("returns light and dark maps", () => {
    const out = mantineGridCssVariablesResolver(mergeMantineTheme(DEFAULT_THEME, createTheme({ primaryColor: "grape" })));
    expect(out.light["--ag-header-background-color"]).toBeTruthy();
    expect(out.dark["--ag-header-background-color"]).toBeTruthy();
    expect(out.light["--ag-header-background-color"]).not.toBe(out.dark["--ag-header-background-color"]);
    expect(out.variables["--ag-accent-color"]).toBe("var(--mantine-color-grape-filled)");
  });
});
