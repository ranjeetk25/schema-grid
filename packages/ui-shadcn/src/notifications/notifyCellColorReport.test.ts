import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cellColorSummary, formatCellColorReport, notifyCellColorReport } from "./notifyCellColorReport";

const report = (over: Partial<Parameters<typeof formatCellColorReport>[0]> = {}) => ({
  color: "red" as const,
  requested: 3,
  applied: 3,
  skipped: 0,
  rejected: 0,
  ...over,
});

describe("formatCellColorReport", () => {
  it("full paint is green", () => {
    expect(formatCellColorReport(report())).toEqual({ title: "Colored red", message: "Colored 3 cells", color: "green" });
  });

  it("clearing reads as cleared", () => {
    expect(formatCellColorReport(report({ color: null, requested: 1, applied: 1 }))).toEqual({
      title: "Color cleared",
      message: "Cleared 1 cell",
      color: "green",
    });
  });

  it("skipped (read-only) and rejected cells make it partial", () => {
    const r = formatCellColorReport(report({ requested: 5, applied: 2, skipped: 2, rejected: 1 }));
    expect(r).toEqual({ title: "Color partially applied", message: "Colored 2 cells, 3 skipped (2 read-only, 1 rejected)", color: "yellow" });
  });

  it("nothing applied is a failure", () => {
    const r = formatCellColorReport(report({ requested: 2, applied: 0, skipped: 2 }));
    expect(r).toEqual({ title: "Nothing colored", message: "Colored 0 cells, 2 skipped (2 read-only)", color: "red" });
  });

  it("cellColorSummary is the status-bar line", () => {
    expect(cellColorSummary(report({ applied: 4, skipped: 1 }))).toBe("Colored 4 cells, 1 skipped (1 read-only)");
  });
});

describe("notifyCellColorReport", () => {
  it("toasts through the lazily loaded sonner by severity", async () => {
    const toast = Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() });
    await expect(notifyCellColorReport(report({ applied: 1, skipped: 2 }), { loader: async () => ({ toast }) })).resolves.toBe("shown");
    expect(toast.warning).toHaveBeenCalledWith(
      "Color partially applied",
      expect.objectContaining({ description: "Colored 1 cell, 2 skipped (2 read-only)" }),
    );
  });

  it("never throws: a missing peer resolves 'unavailable'", async () => {
    const loader = async () => {
      throw new Error("Cannot find module 'sonner'");
    };
    await expect(notifyCellColorReport(report(), { loader })).resolves.toBe("unavailable");
  });

  it("uses a literal specifier bundlers can resolve", () => {
    const src = readFileSync(join(__dirname, "notifyCellColorReport.ts"), "utf8");
    expect(src).toMatch(/import\(\s*["']sonner["']\s*\)/);
  });
});
