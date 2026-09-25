import { describe, expect, it } from "vitest";
import { summarizePreview } from "./index";

describe("@ranjeetk25/schema-grid-ui-shadcn smoke", () => {
  it("the root entry loads and a real export works", () => {
    const summary = { valid: 2, invalid: 1, newOptions: {}, unknownOptions: { c: ["x"] }, unmappedRequired: [] };
    expect(summarizePreview({ rows: [], summary })).toEqual({ valid: 2, invalid: 1, unknownOptions: 1 });
  });
});
