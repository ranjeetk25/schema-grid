/**
 * The DEFAULT loader (no `loader` option) must reach the real optional peer
 * through a literal `import("@mantine/notifications")` — a non-literal
 * specifier is invisible to bundlers and always resolved to "unavailable".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const REPORT = { pastedCells: 2, skippedReadOnly: 0, conflicts: 0, rejected: 0, errors: [] };

afterEach(() => {
  vi.doUnmock("@mantine/notifications");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("notifyClipboardReport default loader", () => {
  it("shows through the installed @mantine/notifications", async () => {
    const show = vi.fn();
    vi.doMock("@mantine/notifications", () => ({ notifications: { show } }));
    const { notifyClipboardReport } = await import("./notifyClipboardReport");
    await expect(notifyClipboardReport(REPORT)).resolves.toBe("shown");
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ title: "Paste complete", message: "Pasted 2 cells" }));
  });

  it("resolves the real module (not mocked) and shows", async () => {
    const real = await import("@mantine/notifications");
    const show = vi.spyOn(real.notifications, "show").mockImplementation(() => "id");
    const { notifyClipboardReport } = await import("./notifyClipboardReport");
    await expect(notifyClipboardReport(REPORT)).resolves.toBe("shown");
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("resolves 'unavailable' when the optional peer fails to load", async () => {
    vi.doMock("@mantine/notifications", () => {
      throw new Error("Cannot find module '@mantine/notifications'");
    });
    const { notifyClipboardReport } = await import("./notifyClipboardReport");
    await expect(notifyClipboardReport(REPORT)).resolves.toBe("unavailable");
  });

  it("uses a literal specifier bundlers can resolve", () => {
    const src = readFileSync(join(__dirname, "notifyClipboardReport.ts"), "utf8");
    expect(src).toMatch(/import\(\s*["']@mantine\/notifications["']\s*\)/);
    expect(src).not.toMatch(/@vite-ignore/);
  });
});
