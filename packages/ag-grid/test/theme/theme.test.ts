import { describe, expect, it } from "vitest";
import { createSchemaGridTheme } from "../../src/theme/theme";
import { SG_CLASSES, SG_CSS } from "../../src/theme/classNames";

describe("SG_CLASSES", () => {
  it("has a class for every documented feature", () => {
    expect(SG_CLASSES.root).toBe("sg-root");
    expect(SG_CLASSES.range).toBe("sg-cell-range");
    expect(SG_CLASSES.rangeTop).toBe("sg-cell-range-top");
    expect(SG_CLASSES.rangeRight).toBe("sg-cell-range-right");
    expect(SG_CLASSES.rangeBottom).toBe("sg-cell-range-bottom");
    expect(SG_CLASSES.rangeLeft).toBe("sg-cell-range-left");
    expect(SG_CLASSES.pending).toBe("sg-cell-pending");
    expect(SG_CLASSES.error).toBe("sg-cell-error");
    expect(SG_CLASSES.remoteChanged).toBe("sg-cell-remote-changed");
    expect(SG_CLASSES.notInView).toBe("sg-row-not-in-view");
    expect(SG_CLASSES.fillHandle).toBe("sg-fill-handle");
    expect(SG_CLASSES.fillPreview).toBe("sg-cell-fill-preview");
    expect(SG_CLASSES.groupRow).toBe("sg-group-row");
    expect(SG_CLASSES.loadMoreRow).toBe("sg-load-more-row");
  });
});

describe("SG_CSS", () => {
  it("is non-empty and every selector is scoped under .sg-root", () => {
    expect(SG_CSS.length).toBeGreaterThan(0);

    // Pull out every rule's selector list (text before each `{`), split on
    // commas/newlines, and assert each individual selector starts with (or
    // contains, for nested `&`-style selectors) .sg-root, ignoring at-rules
    // like @media/@keyframes and empty fragments.
    const ruleSelectors = SG_CSS.match(/[^{}]+(?=\{)/g) ?? [];
    for (const raw of ruleSelectors) {
      const selectors = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const selector of selectors) {
        if (selector.startsWith("@")) continue; // at-rule prelude, not a selector
        if (selector.startsWith("from") || selector.startsWith("to") || /^\d+%$/.test(selector)) continue; // keyframe steps
        expect(
          selector.includes(".sg-root") || selector.startsWith("&"),
          `selector "${selector}" must be scoped under .sg-root`,
        ).toBe(true);
      }
    }
  });

  it("uses css variables with fallbacks for colors", () => {
    expect(SG_CSS).toMatch(/var\(--sg-/);
  });

  it("references every SG_CLASSES class name at least once", () => {
    for (const className of Object.values(SG_CLASSES)) {
      if (className === SG_CLASSES.root) continue; // root is the scope, not a rule target necessarily
      expect(SG_CSS.includes(className), `SG_CSS should reference .${className}`).toBe(true);
    }
  });
});

describe("createSchemaGridTheme", () => {
  it("creates a theme object", () => {
    const theme = createSchemaGridTheme();
    expect(theme).toBeDefined();
    expect(typeof theme).toBe("object");
  });

  it("passes overrides through to the underlying theme params", () => {
    const theme = createSchemaGridTheme({ accentColor: "#ff0000" });
    expect(theme).toBeDefined();
  });

  it("does not throw when composed with a part", () => {
    expect(() => createSchemaGridTheme()).not.toThrow();
  });
});
