/**
 * The DEFAULT loader (no `loader` option) must reach the real optional peer
 * through a literal `import("sonner")` — a non-literal specifier is invisible
 * to bundlers and always resolved to "unavailable".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const REPORT = { pastedCells: 2, skippedReadOnly: 0, conflicts: 0, errors: [] };

afterEach(() => {
  vi.doUnmock("sonner");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("notifyClipboardReport default loader", () => {
  it("shows through the installed sonner", async () => {
    const toast = Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn() });
    vi.doMock("sonner", () => ({ toast }));
    const { notifyClipboardReport } = await import("./notifyClipboardReport");
    await expect(notifyClipboardReport(REPORT)).resolves.toBe("shown");
    expect(toast.success).toHaveBeenCalledWith("Paste complete", expect.objectContaining({ description: "Pasted 2 cells" }));
  });

  it("resolves the real module (not mocked) and shows", async () => {
    const real = await import("sonner");
    const success = vi.spyOn(real.toast, "success").mockImplementation(() => "id");
    const { notifyClipboardReport } = await import("./notifyClipboardReport");
    await expect(notifyClipboardReport(REPORT)).resolves.toBe("shown");
    expect(success).toHaveBeenCalledTimes(1);
  });

  it("resolves 'unavailable' when the optional peer fails to load", async () => {
    vi.doMock("sonner", () => {
      throw new Error("Cannot find module 'sonner'");
    });
    const { notifyClipboardReport } = await import("./notifyClipboardReport");
    await expect(notifyClipboardReport(REPORT)).resolves.toBe("unavailable");
  });

  it("uses a literal specifier bundlers can resolve", () => {
    const src = readFileSync(join(__dirname, "notifyClipboardReport.ts"), "utf8");
    expect(src).toMatch(/import\(\s*["']sonner["']\s*\)/);
    expect(src).not.toMatch(/@vite-ignore/);
  });
});
