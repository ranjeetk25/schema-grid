/**
 * Regression: the decoration CSS injected through the Theming API part is
 * wrapped by AG Grid in the theme's scope class, which lands on the grid's
 * `ag-styled-root` element — INSIDE `<div class="sg-root">`. Selectors that
 * still require a `.sg-root` ancestor below that scope never match, so range
 * highlight, the fill handle (0×0, undraggable), pending/error/remote and
 * not-in-view styling were all invisible in a real browser (found by the
 * apps/storybook Playwright suite).
 */
import { vi } from "vitest";

const partCss = vi.hoisted(() => [] as string[]);

vi.mock("ag-grid-community", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ag-grid-community")>();
  return {
    ...mod,
    createPart: ((args: Parameters<typeof mod.createPart>[0]) => {
      if (typeof args.css === "string") partCss.push(args.css);
      return mod.createPart(args);
    }) as typeof mod.createPart,
  };
});

import { describe, expect, it } from "vitest";
import { SG_CLASSES } from "../../src/theme/classNames";
import { renderGrid } from "../renderGrid";

/** Top-level rule selectors of a stylesheet string (keyframe steps and at-rules skipped). */
function ruleSelectors(css: string): string[] {
  const withoutKeyframes = css.replace(
    /@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
    "",
  );
  return (withoutKeyframes.match(/[^{}]+(?=\{)/g) ?? [])
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("@"));
}

describe("schemaGrid theme part CSS scope", () => {
  it("every selector matches its target inside the element AG Grid scopes the part to", async () => {
    const { container, waitForRows } = renderGrid();
    await waitForRows();
    const css = partCss.find((c) => c.includes(SG_CLASSES.range));
    expect(css, "the schemaGrid part was created with our CSS").toBeDefined();

    const themed = container.querySelector<HTMLElement>(
      '[class*="ag-theme-schemaGrid"]',
    );
    expect(themed, "AG Grid applied the part's scope class").not.toBeNull();
    expect(
      container.querySelector(`.${SG_CLASSES.root}`)?.contains(themed),
    ).toBe(true);
    const scopeClass = [...(themed as HTMLElement).classList].find((c) =>
      c.startsWith("ag-theme-schemaGrid"),
    );

    const cell = container.querySelector<HTMLElement>(".ag-row .ag-cell");
    expect(cell).not.toBeNull();
    for (const selector of ruleSelectors(css as string)) {
      const target = /\.(sg-[a-z-]+)\s*$/.exec(selector)?.[1];
      if (!target) continue;
      const probe = document.createElement("span");
      probe.className = target;
      (cell as HTMLElement).append(probe);
      // AG Grid emits the part as `:where(.<scope>) { & <selector> }`.
      expect(
        probe.matches(`:where(.${scopeClass}) ${selector}`),
        `"${selector}" must match under .${scopeClass}`,
      ).toBe(true);
      probe.remove();
    }
  });

  it("keeps @keyframes out of the part (invalid nested in its scope rule) and renders them globally", async () => {
    const { container, waitForRows } = renderGrid();
    await waitForRows();
    const css = partCss.find((c) => c.includes(SG_CLASSES.range)) as string;
    expect(css).not.toMatch(/@keyframes/);
    const global = [...container.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("\n");
    expect(global).toMatch(/@keyframes sg-remote-flash/);
  });
});
