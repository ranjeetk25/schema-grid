import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilterNode } from "../internal/core-contracts";
import { type UseFilterApplyOptions, useFilterApply } from "./useFilterApply";

const A: FilterNode = { op: "and", children: [{ columnId: "col_payment", operator: "isNot", value: "paid" }] };
const B: FilterNode = { op: "or", children: [{ columnId: "col_payment", operator: "isNot", value: "paid" }] };
const C: FilterNode = { op: "and", children: [{ columnId: "col_notes", operator: "isEmpty" }] };

function setup(initial: Partial<UseFilterApplyOptions> = {}) {
  const onApply = vi.fn<(f: FilterNode | null) => void>();
  const r = renderHook((props: Partial<UseFilterApplyOptions>) => useFilterApply({ value: null, onApply, ...props }), {
    initialProps: initial,
  });
  return { ...r, onApply };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFilterApply", () => {
  it("live: a 300ms debounce collapses a burst of drafts into one apply", () => {
    const { result, onApply } = setup();
    act(() => result.current.setDraft(A));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setDraft(B));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setDraft(C));
    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
    act(() => vi.advanceTimersByTime(299));
    expect(onApply).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(C);
    expect(result.current.dirty).toBe(false);
    expect(result.current.applied).toBe(C);
  });

  it("live: invalid drafts never emit", () => {
    const { result, onApply } = setup();
    act(() => result.current.setDraft(A, false));
    act(() => vi.advanceTimersByTime(1_000));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("live: returning to the applied filter cancels the pending apply", () => {
    const { result, onApply } = setup({ value: A });
    act(() => result.current.setDraft(C));
    act(() => result.current.setDraft(structuredClone(A)));
    act(() => vi.advanceTimersByTime(1_000));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("honours a custom debounceMs", () => {
    const { result, onApply } = setup({ debounceMs: 50 });
    act(() => result.current.setDraft(A));
    act(() => vi.advanceTimersByTime(50));
    expect(onApply).toHaveBeenCalledWith(A);
  });

  it("explicit mode never auto-emits; apply() emits once", () => {
    const { result, onApply } = setup({ mode: "server", rowCount: 20_000 });
    expect(result.current.live).toBe(false);
    act(() => result.current.setDraft(A));
    act(() => vi.advanceTimersByTime(10_000));
    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
    expect(result.current.pendingChanges).toBe(1);
    act(() => result.current.apply());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(A);
    act(() => result.current.apply());
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("explicit mode: discard restores the applied filter", () => {
    const { result, onApply } = setup({ value: A, mode: "client", rowCount: 50_000 });
    act(() => result.current.setDraft(C));
    act(() => result.current.discard());
    expect(result.current.draft).toBe(A);
    expect(result.current.dirty).toBe(false);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("a new controlled value (view switch) resets the draft and cancels the pending apply", () => {
    const { result, rerender, onApply } = setup({ value: A });
    act(() => result.current.setDraft(C));
    rerender({ value: B });
    expect(result.current.draft).toBe(B);
    expect(result.current.dirty).toBe(false);
    act(() => vi.advanceTimersByTime(1_000));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("the parent echoing the emitted value back is not an external change", () => {
    const { result, rerender, onApply } = setup({ value: null });
    act(() => result.current.setDraft(A));
    act(() => vi.advanceTimersByTime(300));
    rerender({ value: structuredClone(A) });
    expect(result.current.dirty).toBe(false);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("switching to explicit (row count grew) cancels the pending apply; back to live re-schedules", () => {
    const { result, rerender, onApply } = setup({ mode: "server", rowCount: 10 });
    act(() => result.current.setDraft(A));
    rerender({ mode: "server", rowCount: 10_000 });
    act(() => vi.advanceTimersByTime(1_000));
    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.live).toBe(false);
    rerender({ mode: "server", rowCount: 10 });
    act(() => vi.advanceTimersByTime(300));
    expect(onApply).toHaveBeenCalledWith(A);
  });

  it("clears the timer on unmount", () => {
    const { result, unmount, onApply } = setup();
    act(() => result.current.setDraft(A));
    unmount();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onApply).not.toHaveBeenCalled();
  });
});
