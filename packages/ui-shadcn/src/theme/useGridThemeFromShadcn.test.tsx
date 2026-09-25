import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGridThemeParams, shadcnGridCssVariables, useGridThemeFromShadcn } from "./useGridThemeFromShadcn";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.removeProperty("--sg-ui-background");
});

describe("useGridThemeFromShadcn", () => {
  it("builds a grid theme that reads the --sg-* contract by default", () => {
    const { result } = renderHook(() => useGridThemeFromShadcn());
    expect(result.current.scheme).toBe("light");
    expect(result.current.theme).toBeTruthy();
    expect(result.current.params.backgroundColor).toBe("#ffffff");
    expect(result.current.params.browserColorScheme).toBe("light");
  });

  it("keeps the theme identity stable across renders", () => {
    const { result, rerender } = renderHook(() => useGridThemeFromShadcn());
    const first = result.current.theme;
    rerender();
    expect(result.current.theme).toBe(first);
    expect(result.current).toBe(result.current);
  });

  it("keeps identity for equal inline options", () => {
    const { result, rerender } = renderHook(() => useGridThemeFromShadcn({ accentColor: "#ff0000" }));
    const first = result.current.theme;
    rerender();
    expect(result.current.theme).toBe(first);
  });

  it("an accentColor override changes the theme and params", () => {
    const base = renderHook(() => useGridThemeFromShadcn()).result.current.theme;
    const { result } = renderHook(() => useGridThemeFromShadcn({ accentColor: "#ff0000" }));
    expect(result.current.theme).not.toBe(base);
    expect(result.current.params.accentColor).toBe("#ff0000");
  });

  it("starts dark when <html> has .dark", () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useGridThemeFromShadcn());
    expect(result.current.scheme).toBe("dark");
    expect(result.current.params.browserColorScheme).toBe("dark");
    expect(result.current.params.backgroundColor).toBe(resolveGridThemeParams("dark").backgroundColor);
  });

  it("tracks .dark on <html> live", async () => {
    const { result } = renderHook(() => useGridThemeFromShadcn());
    const light = result.current.theme;
    await act(async () => {
      document.documentElement.classList.add("dark");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.scheme).toBe("dark");
    expect(result.current.params.backgroundColor).toBe("#18181b");
    await act(async () => {
      document.documentElement.classList.remove("dark");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.scheme).toBe("light");
    // Same scheme + options → same theme object.
    expect(result.current.theme).toBe(light);
  });

  it("watches a provided root element instead of <html>", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { result } = renderHook(() => useGridThemeFromShadcn({ root }));
    expect(result.current.scheme).toBe("light");
    await act(async () => {
      root.classList.add("dark");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.scheme).toBe("dark");
    root.remove();
  });

  it("reads resolved token values from computed style when the host sets them", () => {
    document.documentElement.style.setProperty("--sg-ui-background", "#101010");
    const { result } = renderHook(() => useGridThemeFromShadcn());
    expect(result.current.params.backgroundColor).toBe("#101010");
  });
});

describe("resolveGridThemeParams", () => {
  it("mirrors the light and dark token values", () => {
    const light = resolveGridThemeParams("light");
    const dark = resolveGridThemeParams("dark");
    expect(light.backgroundColor).toBe("#ffffff");
    expect(light.accentColor).toBe("#5e6ad2");
    expect(light.headerBackgroundColor).toBe("#fafafa");
    expect(light.fontSize).toBe(13);
    expect(dark.backgroundColor).toBe("#18181b");
    expect(dark.accentColor).toBe("#7c86dc");
    expect(dark.headerBackgroundColor).not.toBe(light.headerBackgroundColor);
  });
});

describe("shadcnGridCssVariables", () => {
  it("maps the --sg-* grid contract onto the kit tokens", () => {
    expect(shadcnGridCssVariables["--sg-accent-color"]).toBe("var(--sg-ui-primary)");
    expect(shadcnGridCssVariables["--sg-background-color"]).toBe("var(--sg-ui-background)");
    expect(shadcnGridCssVariables["--sg-header-background-color"]).toBe("var(--sg-ui-subtle)");
    expect(shadcnGridCssVariables["--sg-font-family"]).toBe("var(--sg-ui-font)");
  });
});
