import { describe, expect, it } from "vitest";
import type { FilterNode } from "../internal/core-contracts";
import {
  DEFAULT_FILTER_DEBOUNCE_MS,
  DEFAULT_LIVE_FILTER_THRESHOLD,
  type FilterApplyState,
  countFilterChanges,
  filterApplyReducer,
  initFilterApplyState,
  isLiveApply,
  resolveFilterApplyConfig,
  sameFilter,
} from "./filterApplyModel";

const A: FilterNode = { op: "and", children: [{ columnId: "col_payment", operator: "isNot", value: "paid" }] };
const B: FilterNode = {
  op: "and",
  children: [
    { columnId: "col_payment", operator: "isNot", value: "paid" },
    { columnId: "col_call", operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

const live = (applied: FilterNode | null = null): FilterApplyState => initFilterApplyState(applied, {});
const explicit = (applied: FilterNode | null = null): FilterApplyState =>
  initFilterApplyState(applied, { mode: "server", rowCount: 50_000 });

describe("isLiveApply / resolveFilterApplyConfig", () => {
  it("defaults: 5 000 for server, 10 000 for client, 300ms debounce", () => {
    expect(DEFAULT_LIVE_FILTER_THRESHOLD).toEqual({ server: 5_000, client: 10_000 });
    expect(DEFAULT_FILTER_DEBOUNCE_MS).toBe(300);
    expect(resolveFilterApplyConfig({})).toEqual({ mode: "client", threshold: 10_000, debounceMs: 300, live: true });
    expect(resolveFilterApplyConfig({ mode: "server" }).threshold).toBe(5_000);
  });

  it("is live when rowCount is unknown", () => {
    expect(isLiveApply({ mode: "server" })).toBe(true);
    expect(isLiveApply({ mode: "client" })).toBe(true);
    expect(isLiveApply({})).toBe(true);
  });

  it("is live at or below the threshold, explicit above it", () => {
    expect(isLiveApply({ mode: "server", rowCount: 5_000 })).toBe(true);
    expect(isLiveApply({ mode: "server", rowCount: 5_001 })).toBe(false);
    expect(isLiveApply({ mode: "client", rowCount: 10_000 })).toBe(true);
    expect(isLiveApply({ mode: "client", rowCount: 10_001 })).toBe(false);
  });

  it("honours a custom threshold and debounce", () => {
    expect(isLiveApply({ mode: "server", rowCount: 100, liveFilterThreshold: 50 })).toBe(false);
    expect(isLiveApply({ mode: "client", rowCount: 50, liveFilterThreshold: 50 })).toBe(true);
    expect(resolveFilterApplyConfig({ debounceMs: 0 }).debounceMs).toBe(0);
  });

  it("sanitises a negative debounce to 0", () => {
    expect(resolveFilterApplyConfig({ debounceMs: -10 }).debounceMs).toBe(0);
  });
});

describe("sameFilter / countFilterChanges", () => {
  it("compares ASTs structurally, treating null and undefined alike", () => {
    expect(sameFilter(A, structuredClone(A))).toBe(true);
    expect(sameFilter(null, undefined)).toBe(true);
    expect(sameFilter(A, B)).toBe(false);
  });

  it("counts added, removed and edited conditions", () => {
    expect(countFilterChanges(A, A)).toBe(0);
    expect(countFilterChanges(null, null)).toBe(0);
    expect(countFilterChanges(A, B)).toBe(1); // added
    expect(countFilterChanges(B, A)).toBe(1); // removed
    expect(countFilterChanges(null, B)).toBe(2);
    const edited: FilterNode = { op: "and", children: [{ columnId: "col_payment", operator: "is", value: "paid" }] };
    expect(countFilterChanges(A, edited)).toBe(1); // edited = one removed + one added, paired
  });

  it("counts a conjunction flip as one change", () => {
    expect(countFilterChanges(B, { ...B, op: "or" })).toBe(1);
    expect(countFilterChanges(B, { op: "or", children: [B.children[0] as FilterNode] })).toBe(1); // single child: op is moot
    expect(countFilterChanges(B, { op: "or", children: [...B.children, { columnId: "col_notes", operator: "isEmpty" }] })).toBe(2);
  });

  it("counts any other structural change as one", () => {
    const nested: FilterNode = { op: "and", children: [{ op: "or", children: [...B.children] }] };
    expect(countFilterChanges(B, nested)).toBe(1);
  });
});

describe("filterApplyReducer — live mode", () => {
  it("initial state", () => {
    expect(live(A)).toEqual({ applied: A, draft: A, dirty: false, live: true, debounceMs: 300 });
  });

  it("a valid draft marks dirty and schedules an apply after debounceMs", () => {
    const { state, effects } = filterApplyReducer(live(), { type: "draftChanged", node: A, valid: true });
    expect(state).toMatchObject({ applied: null, draft: A, dirty: true });
    expect(effects).toEqual([{ type: "schedule", delay: 300 }]);
  });

  it("an invalid draft never emits, keeps the last valid draft and cancels a pending apply", () => {
    const s1 = filterApplyReducer(live(), { type: "draftChanged", node: A, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "draftChanged", node: B, valid: false });
    expect(state.draft).toBe(A);
    expect(effects).toEqual([{ type: "cancel" }]);
    expect(effects.some((e) => e.type === "emit")).toBe(false);
  });

  it("a draft equal to the applied filter is not dirty and cancels the pending apply", () => {
    const s1 = filterApplyReducer(live(A), { type: "draftChanged", node: B, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "draftChanged", node: structuredClone(A), valid: true });
    expect(state.dirty).toBe(false);
    expect(effects).toEqual([{ type: "cancel" }]);
  });

  it("apply (the timer firing) emits the draft and cleans", () => {
    const s1 = filterApplyReducer(live(), { type: "draftChanged", node: B, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "apply" });
    expect(state).toMatchObject({ applied: B, draft: B, dirty: false });
    expect(effects).toEqual([{ type: "cancel" }, { type: "emit", filter: B }]);
  });

  it("emitting the same filter as applied is a no-op", () => {
    const { state, effects } = filterApplyReducer(live(A), { type: "apply" });
    expect(state).toEqual(live(A));
    expect(effects).toEqual([{ type: "cancel" }]);
  });

  it("debounceMs 0 applies synchronously (no timer)", () => {
    const s0 = initFilterApplyState(null, { debounceMs: 0 });
    const { state, effects } = filterApplyReducer(s0, { type: "draftChanged", node: A, valid: true });
    expect(state).toMatchObject({ applied: A, draft: A, dirty: false });
    expect(effects).toEqual([{ type: "cancel" }, { type: "emit", filter: A }]);
  });

  it("clearing to null is a valid draft and emits null", () => {
    const s1 = filterApplyReducer(live(A), { type: "draftChanged", node: null, valid: true }).state;
    const { effects } = filterApplyReducer(s1, { type: "apply" });
    expect(effects).toContainEqual({ type: "emit", filter: null });
  });
});

describe("filterApplyReducer — explicit mode", () => {
  it("a valid draft only marks dirty; nothing is scheduled", () => {
    const s0 = explicit();
    expect(s0.live).toBe(false);
    const { state, effects } = filterApplyReducer(s0, { type: "draftChanged", node: A, valid: true });
    expect(state).toMatchObject({ draft: A, dirty: true });
    expect(effects).toEqual([]);
  });

  it("apply emits", () => {
    const s1 = filterApplyReducer(explicit(), { type: "draftChanged", node: A, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "apply" });
    expect(state.applied).toBe(A);
    expect(effects).toContainEqual({ type: "emit", filter: A });
  });

  it("discard (and its alias reset) restores the applied filter", () => {
    const s1 = filterApplyReducer(explicit(A), { type: "draftChanged", node: B, valid: true }).state;
    for (const type of ["discard", "reset"] as const) {
      const { state, effects } = filterApplyReducer(s1, { type });
      expect(state).toMatchObject({ applied: A, draft: A, dirty: false });
      expect(effects).toEqual([{ type: "cancel" }]);
    }
  });

  it("an invalid draft in explicit mode changes nothing", () => {
    const s0 = explicit(A);
    const { state, effects } = filterApplyReducer(s0, { type: "draftChanged", node: B, valid: false });
    expect(state).toBe(s0);
    expect(effects).toEqual([]);
  });
});

describe("filterApplyReducer — external changes and config", () => {
  it("appliedExternally (a view switch) replaces applied and draft without emitting", () => {
    const s1 = filterApplyReducer(live(), { type: "draftChanged", node: A, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "appliedExternally", node: B });
    expect(state).toMatchObject({ applied: B, draft: B, dirty: false });
    expect(effects).toEqual([{ type: "cancel" }]);
  });

  it("appliedExternally with the already-applied filter keeps the draft", () => {
    const s1 = filterApplyReducer(explicit(A), { type: "draftChanged", node: B, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "appliedExternally", node: structuredClone(A) });
    expect(state).toBe(s1);
    expect(effects).toEqual([]);
  });

  it("configChanged live → explicit cancels the pending apply but keeps dirty", () => {
    const s1 = filterApplyReducer(live(), { type: "draftChanged", node: A, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "configChanged", options: { mode: "server", rowCount: 9_999 } });
    expect(state).toMatchObject({ live: false, dirty: true });
    expect(effects).toEqual([{ type: "cancel" }]);
  });

  it("configChanged explicit → live schedules pending dirty changes", () => {
    const s1 = filterApplyReducer(explicit(), { type: "draftChanged", node: A, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "configChanged", options: { mode: "server", rowCount: 10, debounceMs: 50 } });
    expect(state).toMatchObject({ live: true, debounceMs: 50 });
    expect(effects).toEqual([{ type: "schedule", delay: 50 }]);
  });

  it("configChanged explicit → live with debounceMs 0 applies pending changes at once", () => {
    const s1 = filterApplyReducer(explicit(), { type: "draftChanged", node: A, valid: true }).state;
    const { state, effects } = filterApplyReducer(s1, { type: "configChanged", options: { debounceMs: 0 } });
    expect(state).toMatchObject({ live: true, applied: A, dirty: false });
    expect(effects).toContainEqual({ type: "emit", filter: A });
  });

  it("configChanged with an unchanged config is a no-op", () => {
    const s0 = live();
    const { state, effects } = filterApplyReducer(s0, { type: "configChanged", options: {} });
    expect(state).toBe(s0);
    expect(effects).toEqual([]);
  });

  it("the reducer is pure: it never mutates the input state", () => {
    const s0 = Object.freeze(live(A));
    expect(() => filterApplyReducer(s0, { type: "draftChanged", node: B, valid: true })).not.toThrow();
    expect(s0.draft).toBe(A);
  });
});
