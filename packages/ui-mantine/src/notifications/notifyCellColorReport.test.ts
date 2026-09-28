import { describe, expect, it, vi } from "vitest";
import {
  formatCellColorReport,
  notifyCellColorReport,
} from "./notifyCellColorReport";

const report = (
  over: Partial<Parameters<typeof formatCellColorReport>[0]> = {},
) => ({
  color: "red" as const,
  requested: 4,
  applied: 4,
  skipped: 0,
  rejected: 0,
  ...over,
});

describe("formatCellColorReport", () => {
  it("nothing to report when every cell was painted", () => {
    expect(formatCellColorReport(report())).toBeNull();
  });

  it("skipped read-only cells are a yellow partial report", () => {
    expect(formatCellColorReport(report({ applied: 3, skipped: 1 }))).toEqual({
      title: "Color partially applied",
      message: "Colored 3 cells red, 1 skipped (read-only)",
      color: "yellow",
    });
  });

  it("rejected cells count separately; clearing says 'Cleared'", () => {
    expect(
      formatCellColorReport(
        report({ color: null, applied: 1, skipped: 2, rejected: 1 }),
      ),
    ).toEqual({
      title: "Color partially applied",
      message:
        "Cleared the color of 1 cell, 2 skipped (read-only), 1 not saved",
      color: "yellow",
    });
  });

  it("nothing applied is red", () => {
    const r = formatCellColorReport(report({ applied: 0, skipped: 4 }));
    expect(r?.title).toBe("Nothing colored");
    expect(r?.color).toBe("red");
    expect(r?.message).toBe("Colored 0 cells red, 4 skipped (read-only)");
  });
});

describe("notifyCellColorReport", () => {
  it("shows a toast through the lazily loaded notifications module", async () => {
    const show = vi.fn();
    const out = await notifyCellColorReport(
      report({ applied: 2, skipped: 2 }),
      { loader: async () => ({ notifications: { show } }) },
    );
    expect(out).toBe("shown");
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Color partially applied" }),
    );
  });

  it("stays quiet when nothing was skipped", async () => {
    const loader = vi.fn(async () => ({ notifications: { show: vi.fn() } }));
    expect(await notifyCellColorReport(report(), { loader })).toBe("nothing");
    expect(loader).not.toHaveBeenCalled();
  });

  it("answers unavailable when the peer is missing", async () => {
    expect(
      await notifyCellColorReport(report({ skipped: 1 }), {
        loader: () => Promise.reject(new Error("missing")),
      }),
    ).toBe("unavailable");
  });
});
