import { describe, expect, it, vi } from "vitest";
import { formatClipboardReport, notifyClipboardReport } from "./notifyClipboardReport";

const errs = (n: number) => Array.from({ length: n }, (_, i) => ({ rowId: `r${i}`, columnId: "c", message: `bad ${i}` }));

describe("formatClipboardReport", () => {
  it("full success is green", () => {
    expect(formatClipboardReport({ pastedCells: 40, skippedReadOnly: 0, conflicts: 0, errors: [] })).toEqual({
      title: "Paste complete",
      message: "Pasted 40 cells",
      color: "green",
    });
  });
  it("partial is yellow with breakdown", () => {
    const r = formatClipboardReport({ pastedCells: 40, skippedReadOnly: 1, conflicts: 0, errors: errs(2) });
    expect(r.message).toBe("Pasted 40 cells, 3 skipped (2 invalid, 1 read-only)");
    expect(r.color).toBe("yellow");
  });
  it("total failure is red", () => {
    const r = formatClipboardReport({ pastedCells: 0, skippedReadOnly: 0, conflicts: 0, errors: errs(3) });
    expect(r.message).toBe("Pasted 0 cells, 3 skipped (3 invalid)");
    expect(r.color).toBe("red");
    expect(r.title).toBe("Paste failed");
  });
  it("counts conflicts and treats them as partial", () => {
    const r = formatClipboardReport({ pastedCells: 5, skippedReadOnly: 0, conflicts: 1, errors: [] });
    expect(r.message).toBe("Pasted 5 cells, 1 conflict");
    expect(r.color).toBe("yellow");
  });
  it("singular cell", () => {
    expect(formatClipboardReport({ pastedCells: 1, skippedReadOnly: 0, conflicts: 0, errors: [] }).message).toBe("Pasted 1 cell");
  });
});

describe("notifyClipboardReport", () => {
  it("shows through the lazily loaded notifications module", async () => {
    const show = vi.fn();
    const result = await notifyClipboardReport(
      { pastedCells: 2, skippedReadOnly: 0, conflicts: 0, errors: [] },
      { loader: async () => ({ notifications: { show } }) },
    );
    expect(result).toBe("shown");
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ title: "Paste complete", message: "Pasted 2 cells", color: "green" }));
  });
  it("returns unavailable when the loader rejects", async () => {
    const result = await notifyClipboardReport(
      { pastedCells: 2, skippedReadOnly: 0, conflicts: 0, errors: [] },
      { loader: () => Promise.reject(new Error("Cannot find module")) },
    );
    expect(result).toBe("unavailable");
  });
  it("returns unavailable when the module has no notifications export", async () => {
    const result = await notifyClipboardReport({ pastedCells: 2, skippedReadOnly: 0, conflicts: 0, errors: [] }, { loader: async () => ({}) });
    expect(result).toBe("unavailable");
  });
});
