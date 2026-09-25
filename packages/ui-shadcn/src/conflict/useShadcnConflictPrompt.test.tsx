import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangeConflict } from "../internal/core-contracts";
import { useShadcnConflictPrompt } from "./useShadcnConflictPrompt";

const conflict = (rowId: string): ChangeConflict => ({
  rowId,
  columnId: "c",
  serverValue: "paid",
  serverVersion: 2,
  updatedAt: "2026-09-25T10:00:00.000Z",
});

describe("useShadcnConflictPrompt", () => {
  it("queues onConflict calls and resolves them in order through ag-grid's resolve", async () => {
    const { result } = renderHook(() => useShadcnConflictPrompt());
    const r1 = vi.fn(async () => {});
    const r2 = vi.fn(async () => {});
    act(() => {
      result.current.onConflict(conflict("r1"), r1);
      result.current.onConflict(conflict("r2"), r2);
    });
    expect(result.current.conflict?.rowId).toBe("r1");
    expect(result.current.opened).toBe(true);
    expect(result.current.pendingCount).toBe(2);
    await act(async () => {
      await result.current.resolve("overwrite");
    });
    expect(r1).toHaveBeenCalledWith("overwrite");
    expect(result.current.conflict?.rowId).toBe("r2");
    await act(async () => {
      await result.current.resolve("keepTheirs");
    });
    expect(r2).toHaveBeenCalledWith("keepTheirs");
    expect(result.current.conflict).toBeNull();
    expect(result.current.opened).toBe(false);
  });

  it("dismiss closes without resolving; reopen shows the same conflict", () => {
    const { result } = renderHook(() => useShadcnConflictPrompt());
    const r1 = vi.fn(async () => {});
    act(() => result.current.onConflict(conflict("r1"), r1));
    act(() => result.current.dismiss());
    expect(result.current.opened).toBe(false);
    expect(result.current.pendingCount).toBe(1);
    expect(r1).not.toHaveBeenCalled();
    act(() => result.current.reopen());
    expect(result.current.opened).toBe(true);
    expect(result.current.conflict?.rowId).toBe("r1");
  });
});
