import { describe, expect, it, vi } from "vitest";
import { formatClipboardReport, notifyClipboardReport } from "./notifyClipboardReport";

const errs = (n: number) => Array.from({ length: n }, (_, i) => ({ rowId: `r${i}`, columnId: "c", message: `bad ${i}` }));

describe("formatClipboardReport", () => {
  it("full success is green", () => {
    expect(formatClipboardReport({ pastedCells: 40, skippedReadOnly: 0, conflicts: 0, rejected: 0, errors: [] })).toEqual({
      title: "Paste complete",
      message: "Pasted 40 cells",
      color: "green",
    });
  });
  it("partial is yellow with breakdown", () => {
    const r = formatClipboardReport({ pastedCells: 40, skippedReadOnly: 1, conflicts: 0, rejected: 0, errors: errs(2) });
    expect(r.message).toBe("Pasted 40 cells, 3 skipped (2 invalid, 1 read-only)");
    expect(r.color).toBe("yellow");
  });
  it("total failure is red", () => {
    const r = formatClipboardReport({ pastedCells: 0, skippedReadOnly: 0, conflicts: 0, rejected: 0, errors: errs(3) });
    expect(r.message).toBe("Pasted 0 cells, 3 skipped (3 invalid)");
    expect(r.color).toBe("red");
    expect(r.title).toBe("Paste failed");
  });
  it("counts conflicts and treats them as partial", () => {
    const r = formatClipboardReport({ pastedCells: 5, skippedReadOnly: 0, conflicts: 1, rejected: 0, errors: [] });
    expect(r.message).toBe("Pasted 5 cells, 1 conflict");
    expect(r.color).toBe("yellow");
  });
  it("singular cell", () => {
    expect(formatClipboardReport({ pastedCells: 1, skippedReadOnly: 0, conflicts: 0, rejected: 0, errors: [] }).message).toBe("Pasted 1 cell");
  });
});

function fakeSonner() {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() });
  return { toast };
}

const OK = { pastedCells: 2, skippedReadOnly: 0, conflicts: 0, rejected: 0, errors: [] };

describe("notifyClipboardReport", () => {
  it("shows through the lazily loaded sonner module", async () => {
    const mod = fakeSonner();
    const result = await notifyClipboardReport(OK, { loader: async () => mod });
    expect(result).toBe("shown");
    expect(mod.toast.success).toHaveBeenCalledWith("Paste complete", expect.objectContaining({ description: "Pasted 2 cells" }));
  });
  it("routes severity: partial → warning, failure → error, nothing → plain toast", async () => {
    const mod = fakeSonner();
    const loader = async () => mod;
    await notifyClipboardReport({ pastedCells: 4, skippedReadOnly: 1, conflicts: 0, rejected: 0, errors: [] }, { loader });
    expect(mod.toast.warning).toHaveBeenCalledWith("Paste partially applied", expect.objectContaining({ description: "Pasted 4 cells, 1 skipped (1 read-only)" }));
    await notifyClipboardReport({ pastedCells: 0, skippedReadOnly: 0, conflicts: 0, rejected: 0, errors: errs(1) }, { loader });
    expect(mod.toast.error).toHaveBeenCalledWith("Paste failed", expect.objectContaining({ description: "Pasted 0 cells, 1 skipped (1 invalid)" }));
    await notifyClipboardReport({ pastedCells: 0, skippedReadOnly: 0, conflicts: 0, rejected: 0, errors: [] }, { loader });
    expect(mod.toast).toHaveBeenCalledWith("Nothing pasted", expect.objectContaining({ description: "Pasted 0 cells" }));
  });
  it("falls back to the plain toast when a severity helper is missing", async () => {
    const toast = vi.fn();
    const result = await notifyClipboardReport(OK, { loader: async () => ({ toast }) });
    expect(result).toBe("shown");
    expect(toast).toHaveBeenCalledWith("Paste complete", expect.objectContaining({ description: "Pasted 2 cells" }));
  });
  it("accepts a default-export module shape", async () => {
    const mod = fakeSonner();
    const result = await notifyClipboardReport(OK, { loader: async () => ({ default: mod }) });
    expect(result).toBe("shown");
    expect(mod.toast.success).toHaveBeenCalledTimes(1);
  });
  it("returns unavailable when the loader rejects", async () => {
    const result = await notifyClipboardReport(OK, { loader: () => Promise.reject(new Error("Cannot find module")) });
    expect(result).toBe("unavailable");
  });
  it("returns unavailable when the module has no toast export", async () => {
    const result = await notifyClipboardReport(OK, { loader: async () => ({}) });
    expect(result).toBe("unavailable");
  });
  it("returns unavailable when the toast call throws", async () => {
    const toast = Object.assign(vi.fn(), {
      success: vi.fn(() => {
        throw new Error("no Toaster");
      }),
    });
    const result = await notifyClipboardReport(OK, { loader: async () => ({ toast }) });
    expect(result).toBe("unavailable");
  });
});
