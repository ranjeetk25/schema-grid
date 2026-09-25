import { describe, expect, it } from "vitest";
import * as io from "./io-contracts";

describe("io-contracts", () => {
  it("exposes the four io functions", () => {
    for (const name of ["parseFile", "autoMapColumns", "validateRows", "buildExport"] as const) {
      expect(typeof io[name]).toBe("function");
    }
  });

  it("fallbacks fail with a clear not-available error", async () => {
    expect(() => io.autoMapColumns([], [])).toThrow(/not available/);
    await expect(io.parseFile(new Blob([""]))).rejects.toThrow(/not available/);
  });
});
