import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilterNode } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import {
  DEFAULT_CLIENT_LIVE_FILTER_THRESHOLD,
  DEFAULT_SERVER_LIVE_FILTER_THRESHOLD,
  LiveFilterController,
  type LiveFilterState,
  applicableFilter,
  isComplete,
  pruneIncomplete,
  resolveApplyMode,
  shouldApplyLive,
} from "./liveFilter";

const schema = buildFixtureSchema();
const ctx = { schema, registry: buildFixtureRegistry() };

const PAY: FilterNode = { columnId: FIXTURE_IDS.payment, operator: "isNot", value: "paid" };
const NOTES: FilterNode = { columnId: FIXTURE_IDS.notes, operator: "isEmpty" };
const A: FilterNode = { op: "and", children: [PAY] };
const B: FilterNode = { op: "and", children: [PAY, NOTES] };

describe("shouldApplyLive / resolveApplyMode", () => {
  it("is live when the row count is unknown", () => {
    expect(shouldApplyLive()).toBe(true);
    expect(shouldApplyLive({ mode: "server" })).toBe(true);
  });

  it("switches at the per-mode default thresholds", () => {
    expect(shouldApplyLive({ mode: "server", rowCount: DEFAULT_SERVER_LIVE_FILTER_THRESHOLD })).toBe(true);
    expect(shouldApplyLive({ mode: "server", rowCount: DEFAULT_SERVER_LIVE_FILTER_THRESHOLD + 1 })).toBe(false);
    expect(shouldApplyLive({ mode: "client", rowCount: 8_000 })).toBe(true);
    expect(shouldApplyLive({ rowCount: DEFAULT_CLIENT_LIVE_FILTER_THRESHOLD + 1 })).toBe(false);
  });

  it("honours a custom threshold and the live override", () => {
    expect(shouldApplyLive({ mode: "server", rowCount: 200, liveFilterThreshold: 100 })).toBe(false);
    expect(shouldApplyLive({ mode: "server", rowCount: 1e6, live: true })).toBe(true);
    expect(shouldApplyLive({ rowCount: 1, live: false })).toBe(false);
    expect(resolveApplyMode({ mode: "server", rowCount: 1e6 })).toBe("explicit");
  });
});

describe("isComplete / pruneIncomplete", () => {
  it("requires column, operator and a value matching the operator", () => {
    expect(isComplete({ columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" }, ctx)).toBe(true);
    expect(isComplete({ columnId: FIXTURE_IDS.payment, operator: "is", value: null }, ctx)).toBe(false);
    expect(isComplete({ columnId: FIXTURE_IDS.payment, operator: "is", value: "" }, ctx)).toBe(false);
    expect(isComplete({ columnId: FIXTURE_IDS.payment, operator: "isAnyOf", value: [] }, ctx)).toBe(false);
    expect(isComplete({ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }, ctx)).toBe(true);
    expect(isComplete({ columnId: "", operator: "is" }, ctx)).toBe(false);
    expect(isComplete({ columnId: FIXTURE_IDS.payment, operator: "nope", value: "paid" }, ctx)).toBe(false);
    expect(isComplete({ columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" }, { ...ctx, readable: new Set() })).toBe(false);
  });

  it("strips incomplete conditions and the groups they leave empty", () => {
    const node: FilterNode = {
      op: "or",
      children: [
        PAY,
        { columnId: FIXTURE_IDS.amount, operator: "gt", value: null },
        { op: "and", children: [{ columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "lastNDays" } }] },
      ],
    };
    expect(pruneIncomplete(node, ctx)).toStrictEqual({ op: "or", children: [PAY] });
    expect(pruneIncomplete({ op: "and", children: [{ columnId: FIXTURE_IDS.amount, operator: "gt", value: null }] }, ctx)).toBeNull();
    expect(pruneIncomplete(null, ctx)).toBeNull();
  });

  it("applicableFilter blocks (undefined) a pruned filter that still fails validation", () => {
    const tooDeep: FilterNode = { op: "and", children: [{ op: "or", children: [{ op: "and", children: [NOTES] }] }] };
    expect(applicableFilter(tooDeep, ctx)).toBeUndefined();
    expect(applicableFilter(A, ctx)).toStrictEqual(A);
  });
});

function fakeTimer() {
  return {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

function controller(opts: { mode?: "live" | "explicit"; value?: FilterNode | null; apply?: (n: FilterNode | null) => unknown } = {}) {
  const apply = vi.fn(opts.apply ?? (() => undefined));
  const states: LiveFilterState[] = [];
  const c = new LiveFilterController({
    value: opts.value ?? null,
    mode: opts.mode ?? "live",
    apply,
    debounceMs: 300,
    timer: fakeTimer(),
    onState: (s) => states.push(s),
  });
  return { c, apply, states };
}

describe("LiveFilterController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("live: debounces edits and applies only the latest after 300ms", () => {
    const { c, apply } = controller();
    c.edit(A);
    expect(c.state.status).toBe("scheduled");
    vi.advanceTimersByTime(200);
    c.edit(B);
    vi.advanceTimersByTime(299);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(B);
    expect(c.state.status).toBe("idle");
    expect(c.state.appliedKey).toBe(JSON.stringify(B));
  });

  it("live: never re-applies the applied filter; a blocked draft cancels the pending apply", () => {
    const { c, apply } = controller({ value: A });
    c.edit(A);
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
    c.edit(B);
    c.edit(undefined);
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
    expect(c.state.status).toBe("idle");
  });

  it("live: dispose({ flush }) applies a scheduled edit immediately", () => {
    const { c, apply } = controller();
    c.edit(A);
    c.dispose({ flush: true });
    expect(apply).toHaveBeenCalledWith(A);
    vi.advanceTimersByTime(1000);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("explicit: edits stay a draft until flush (Apply); clear applies null", () => {
    const { c, apply } = controller({ mode: "explicit", value: A });
    c.edit(B);
    vi.advanceTimersByTime(5000);
    expect(apply).not.toHaveBeenCalled();
    expect(c.state.dirty).toBe(true);
    c.flush();
    expect(apply).toHaveBeenLastCalledWith(B);
    expect(c.state.dirty).toBe(false);
    c.clear();
    expect(apply).toHaveBeenLastCalledWith(null);
    expect(c.state.appliedKey).toBe("null");
  });

  it("explicit: editing back to the applied filter is not dirty", () => {
    const { c } = controller({ mode: "explicit", value: A });
    c.edit(B);
    expect(c.state.dirty).toBe(true);
    c.edit(A);
    expect(c.state.dirty).toBe(false);
  });

  it("threshold switching: live → explicit cancels the timer; explicit → live schedules the draft", () => {
    const { c, apply } = controller();
    c.edit(A);
    c.setMode("explicit");
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
    expect(c.state.dirty).toBe(true);
    c.setMode("live");
    vi.advanceTimersByTime(300);
    expect(apply).toHaveBeenCalledWith(A);
  });

  it("a rejected apply keeps the previous filter and exposes the error", async () => {
    const { c } = controller({ value: A, apply: () => Promise.reject(new Error("Server said no")) });
    c.edit(B);
    vi.advanceTimersByTime(300);
    expect(c.state.status).toBe("applying");
    await vi.runAllTimersAsync();
    expect(c.state.status).toBe("error");
    expect(c.state.error).toBe("Server said no");
    expect(c.state.appliedKey).toBe(JSON.stringify(A));
  });

  it("a throwing apply is an error too; the next successful apply clears it", () => {
    let fail = true;
    const { c } = controller({
      apply: () => {
        if (fail) throw new Error("boom");
      },
    });
    c.edit(A);
    vi.advanceTimersByTime(300);
    expect(c.state.error).toBe("boom");
    fail = false;
    c.edit(B);
    vi.advanceTimersByTime(300);
    expect(c.state.error).toBeNull();
    expect(c.state.appliedKey).toBe(JSON.stringify(B));
  });

  it("async: latest apply wins and edits during an apply are scheduled after it", async () => {
    let resolve: () => void = () => {};
    const { c, apply } = controller({ apply: () => new Promise<void>((r) => {
          resolve = r;
        }) });
    c.edit(A);
    vi.advanceTimersByTime(300);
    c.edit(B);
    expect(c.state.status).toBe("applying");
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.state.appliedKey).toBe(JSON.stringify(A));
    expect(c.state.status).toBe("scheduled");
    vi.advanceTimersByTime(300);
    expect(apply).toHaveBeenLastCalledWith(B);
  });

  it("setValue: own/in-flight values are not foreign; a foreign value resets and cancels", () => {
    const { c, apply } = controller();
    c.edit(A);
    expect(c.setValue(A)).toBe(false); // host echoed the pending candidate
    expect(c.setValue(B)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
    expect(c.state.appliedKey).toBe(JSON.stringify(B));
    expect(c.setValue(B)).toBe(false);
  });
});
