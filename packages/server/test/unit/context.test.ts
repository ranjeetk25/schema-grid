import { describe, expect, it } from "vitest";
import { createServerContext } from "../../src/context";
import { createDefaultRegistry, createRolePermissionResolver } from "../../src/internal/core";

const base = {
  schema: { id: "g", schemaVersion: 1, columns: [] },
  registry: createDefaultRegistry(),
  resolver: createRolePermissionResolver(),
  user: { id: "u1", roles: ["admin"] },
};

describe("createServerContext", () => {
  it("fills defaults", () => {
    const ctx = createServerContext(base);
    expect(ctx.tz).toBe("Asia/Kolkata");
    expect(ctx.formulaFallbackRowCap).toBe(5000);
    const before = Date.now();
    const n = ctx.now().getTime();
    expect(n).toBeGreaterThanOrEqual(before - 5);
    expect(ctx.onWarning).toBeUndefined();
  });

  it("accepts injected now, tz, cap, warning sink", () => {
    const fixed = new Date("2026-09-25T00:30:00+05:30");
    const warn = () => {};
    const ctx = createServerContext({ ...base, now: () => fixed, tz: "UTC", formulaFallbackRowCap: 10, onWarning: warn });
    expect(ctx.now()).toBe(fixed);
    expect(ctx.tz).toBe("UTC");
    expect(ctx.formulaFallbackRowCap).toBe(10);
    expect(ctx.onWarning).toBe(warn);
  });

  it("is frozen", () => {
    const ctx = createServerContext(base);
    expect(Object.isFrozen(ctx)).toBe(true);
  });
});
