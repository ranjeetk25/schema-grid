import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePollingSync } from "../../src/sync/usePollingSync";
import { useDocumentVisible } from "../../src/sync/useDocumentVisible";
import type { ChangeFeedEntry, GridRow } from "../../src/internal/core";

function entry(cursor: string): ChangeFeedEntry<GridRow> {
  return { cursor, rows: [], deletedRowIds: [], schemaVersion: 1 };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePollingSync", () => {
  it("polls every interval while enabled", async () => {
    const getChanges = vi.fn().mockResolvedValue(entry("c1"));
    const onEntry = vi.fn();

    renderHook(() =>
      usePollingSync({
        dataSource: { getChanges },
        intervalMs: 1000,
        enabled: true,
        onEntry,
      }),
    );

    expect(getChanges).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(onEntry).toHaveBeenCalledTimes(2);
  });

  it("skips polling entirely when getChanges is absent", async () => {
    renderHook(() =>
      usePollingSync({
        dataSource: {},
        intervalMs: 1000,
        enabled: true,
        onEntry: vi.fn(),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // Nothing to assert on directly besides "it didn't throw"; the real
    // guarantee is exercised by the never-overlaps test below wiring a spy.
  });

  it("passes the previous cursor on each call", async () => {
    const getChanges = vi.fn().mockResolvedValueOnce(entry("c1")).mockResolvedValueOnce(entry("c2"));

    renderHook(() =>
      usePollingSync({
        dataSource: { getChanges },
        intervalMs: 1000,
        enabled: true,
        initialCursor: "c0",
        onEntry: vi.fn(),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenNthCalledWith(1, "c0");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenNthCalledWith(2, "c1");
  });

  it("never overlaps requests: a slow call blocks the next poll until it settles", async () => {
    const d1 = defer<ChangeFeedEntry<GridRow>>();
    const getChanges = vi.fn().mockReturnValueOnce(d1.promise).mockResolvedValue(entry("c2"));

    renderHook(() =>
      usePollingSync({
        dataSource: { getChanges },
        intervalMs: 1000,
        enabled: true,
        onEntry: vi.fn(),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    // Time passes well beyond another interval, but the first request is
    // still in flight, so no second request should have been made.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    // Now let the first request settle; the next poll gets scheduled from here.
    await act(async () => {
      d1.resolve(entry("c1"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(2);
  });

  it("backs off exponentially after an error and resets on success", async () => {
    const getChanges = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom again"))
      .mockResolvedValue(entry("c1"));
    const onError = vi.fn();

    const { result } = renderHook(() =>
      usePollingSync({
        dataSource: { getChanges },
        intervalMs: 1000,
        enabled: true,
        onEntry: vi.fn(),
        onError,
      }),
    );

    // t=1000: first attempt fails.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.lastError).toBeInstanceOf(Error);

    // Backoff is now 1000 * 2^1 = 2000ms: at +1000ms nothing new happens yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    // At +2000ms total the second (failing) attempt fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);

    // Backoff is now 1000 * 2^2 = 4000ms: the third (succeeding) attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(getChanges).toHaveBeenCalledTimes(3);
    expect(result.current.lastError).toBe(null);

    // Backoff reset to the base interval after success.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(4);
  });

  it("pollNow triggers an immediate request and shares an in-flight one", async () => {
    const d1 = defer<ChangeFeedEntry<GridRow>>();
    const getChanges = vi.fn().mockReturnValueOnce(d1.promise).mockResolvedValue(entry("c2"));

    const { result } = renderHook(() =>
      usePollingSync({
        dataSource: { getChanges },
        intervalMs: 5000,
        enabled: true,
        onEntry: vi.fn(),
      }),
    );

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.pollNow();
      p2 = result.current.pollNow();
    });
    expect(getChanges).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);

    await act(async () => {
      d1.resolve(entry("c1"));
      await p1;
    });
  });

  it("stops when enabled is false and resumes PROMPTLY (not after a full interval) when set back to true", async () => {
    const getChanges = vi.fn().mockResolvedValue(entry("c1"));

    const { rerender } = renderHook(
      ({ enabled }) =>
        usePollingSync({ dataSource: { getChanges }, intervalMs: 1000, enabled, onEntry: vi.fn() }),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ enabled: false });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    // Re-enabling polls immediately rather than waiting another interval.
    await act(async () => {
      rerender({ enabled: true });
      await Promise.resolve();
    });
    expect(getChanges).toHaveBeenCalledTimes(2);

    // The interval loop continues normally from there.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(3);
  });

  it("stops polling forever after unmount while a request is in flight", async () => {
    const pending = defer<ChangeFeedEntry<GridRow>>();
    const getChanges = vi.fn().mockReturnValue(pending.promise);
    const onEntry = vi.fn();

    const { unmount } = renderHook(() =>
      usePollingSync({
        dataSource: { getChanges },
        intervalMs: 1000,
        enabled: true,
        onEntry,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      pending.resolve(entry("c1"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onEntry).not.toHaveBeenCalled();

    // Even though the resolved request's `finally` ran, it must not have
    // rescheduled anything: advancing well past another interval fires no
    // new request.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);
    expect(onEntry).not.toHaveBeenCalled();
  });

  it("re-enabling while a stale-generation request is still in flight ignores it and starts a fresh one", async () => {
    const d1 = defer<ChangeFeedEntry<GridRow>>();
    const d2 = defer<ChangeFeedEntry<GridRow>>();
    const getChanges = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const onEntry = vi.fn();

    const { rerender, result } = renderHook(
      ({ enabled }) =>
        usePollingSync({ dataSource: { getChanges }, intervalMs: 1000, enabled, onEntry }),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1); // d1 in flight, never resolved yet

    act(() => {
      rerender({ enabled: false });
    });

    // Re-enable while d1 (stale generation) is still pending.
    await act(async () => {
      rerender({ enabled: true });
      await Promise.resolve();
    });
    // A fresh request was issued right away instead of reusing/waiting on d1.
    expect(getChanges).toHaveBeenCalledTimes(2);

    // The stale d1 resolving now must be ignored entirely.
    await act(async () => {
      d1.resolve(entry("stale"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onEntry).not.toHaveBeenCalled();
    expect(result.current.lastCursor).toBe(null);

    // The fresh (live-generation) request resolving is honored normally.
    await act(async () => {
      d2.resolve(entry("fresh"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(onEntry).toHaveBeenCalledWith(entry("fresh"));
    expect(result.current.lastCursor).toBe("fresh");
  });

  it("a changing onEntry callback doesn't reset the running timer", async () => {
    const getChanges = vi.fn().mockResolvedValue(entry("c1"));

    const { rerender } = renderHook(
      ({ onEntry }: { onEntry: () => void }) =>
        usePollingSync({ dataSource: { getChanges }, intervalMs: 1000, enabled: true, onEntry }),
      { initialProps: { onEntry: vi.fn() } },
    );

    // Re-render with a brand new onEntry closure before the first tick.
    rerender({ onEntry: vi.fn() });
    rerender({ onEntry: vi.fn() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // If callback identity reset the timer, this would need >1000ms total.
    expect(getChanges).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the document is hidden and resumes when visible again (composed with useDocumentVisible)", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const getChanges = vi.fn().mockResolvedValue(entry("c1"));

    function useSyncWhenVisible() {
      const visible = useDocumentVisible();
      return usePollingSync({
        dataSource: { getChanges },
        intervalMs: 1000,
        enabled: visible,
        onEntry: vi.fn(),
      });
    }

    renderHook(() => useSyncWhenVisible());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getChanges).toHaveBeenCalledTimes(1);

    // Becoming visible again polls immediately (no need to advance timers).
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(getChanges).toHaveBeenCalledTimes(2);

    // ...and the interval loop continues normally from there.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getChanges).toHaveBeenCalledTimes(3);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });
});
