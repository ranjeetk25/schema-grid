import { type FilterNode, isFilterGroup } from "../internal/core-contracts";

/**
 * How filter edits reach the grid.
 *
 * Live mode: every VALID draft change schedules an apply `debounceMs` later
 * (bursts collapse into one). Explicit mode (large data sets): drafts only
 * mark the state dirty; the host applies on an explicit `apply`.
 *
 * Pure: the reducer returns the next state plus effect descriptors
 * (`schedule` / `cancel` / `emit`) that `useFilterApply` executes.
 */

export type FilterApplyMode = "client" | "server";

export interface FilterApplyOptions {
  /** Where filtering runs. Default "client". */
  mode?: FilterApplyMode;
  /** Total row count, when known. Unknown ⇒ live. */
  rowCount?: number;
  /** Live apply up to this many rows. Default 5 000 (server) / 10 000 (client). */
  liveFilterThreshold?: number;
  /** Live-mode debounce. Default 300ms. */
  debounceMs?: number;
}

export const DEFAULT_LIVE_FILTER_THRESHOLD: Readonly<Record<FilterApplyMode, number>> = Object.freeze({
  server: 5_000,
  client: 10_000,
});

export const DEFAULT_FILTER_DEBOUNCE_MS = 300;

export interface FilterApplyConfig {
  mode: FilterApplyMode;
  threshold: number;
  debounceMs: number;
  live: boolean;
}

export function resolveFilterApplyConfig(options: FilterApplyOptions = {}): FilterApplyConfig {
  const mode = options.mode ?? "client";
  const threshold = options.liveFilterThreshold ?? DEFAULT_LIVE_FILTER_THRESHOLD[mode];
  const debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_FILTER_DEBOUNCE_MS);
  const live = options.rowCount === undefined || options.rowCount <= threshold;
  return { mode, threshold, debounceMs, live };
}

/** Live when the row count is unknown or at most the threshold. */
export function isLiveApply(options: FilterApplyOptions = {}): boolean {
  return resolveFilterApplyConfig(options).live;
}

export interface FilterApplyState {
  /** What the grid currently filters by. */
  applied: FilterNode | null;
  /** The last VALID draft (invalid drafts never replace it). */
  draft: FilterNode | null;
  /** `draft` differs from `applied`. */
  dirty: boolean;
  live: boolean;
  debounceMs: number;
}

export type FilterApplyAction =
  | { type: "draftChanged"; node: FilterNode | null; valid: boolean }
  | { type: "apply" }
  | { type: "discard" }
  /** Alias of `discard`. */
  | { type: "reset" }
  /** The applied filter changed from outside (e.g. a view switch). */
  | { type: "appliedExternally"; node: FilterNode | null }
  | { type: "configChanged"; options: FilterApplyOptions };

export type FilterApplyEffect =
  | { type: "schedule"; delay: number }
  | { type: "cancel" }
  | { type: "emit"; filter: FilterNode | null };

export interface FilterApplyResult {
  state: FilterApplyState;
  effects: FilterApplyEffect[];
}

const serialize = (node: FilterNode | null | undefined): string => JSON.stringify(node ?? null);

/** Structural equality of two filter ASTs (`null` ≡ `undefined`). */
export function sameFilter(a: FilterNode | null | undefined, b: FilterNode | null | undefined): boolean {
  return a === b || serialize(a) === serialize(b);
}

function conditionKeys(node: FilterNode | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (isFilterGroup(node)) {
    for (const c of node.children) conditionKeys(c, out);
  } else {
    out.push(serialize(node));
  }
  return out;
}

/**
 * Number of user-visible changes between two filters: added and removed
 * conditions are paired (an edit counts once); a root AND/OR flip adds one;
 * any other structural change with the same conditions counts as one.
 */
export function countFilterChanges(applied: FilterNode | null | undefined, draft: FilterNode | null | undefined): number {
  if (sameFilter(applied, draft)) return 0;
  const remaining = new Map<string, number>();
  for (const k of conditionKeys(applied)) remaining.set(k, (remaining.get(k) ?? 0) + 1);
  let added = 0;
  for (const k of conditionKeys(draft)) {
    const n = remaining.get(k) ?? 0;
    if (n > 0) remaining.set(k, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of remaining.values()) removed += n;
  const rootOp = (n: FilterNode | null | undefined) => (n && isFilterGroup(n) && n.children.length > 1 ? n.op : null);
  const opFlip = rootOp(applied) && rootOp(draft) && rootOp(applied) !== rootOp(draft) ? 1 : 0;
  return Math.max(Math.max(added, removed) + opFlip, 1);
}

export function initFilterApplyState(applied: FilterNode | null, options: FilterApplyOptions = {}): FilterApplyState {
  const { live, debounceMs } = resolveFilterApplyConfig(options);
  return { applied, draft: applied, dirty: false, live, debounceMs };
}

const NONE: FilterApplyEffect[] = [];
const CANCEL: FilterApplyEffect = { type: "cancel" };

export function filterApplyReducer(state: FilterApplyState, action: FilterApplyAction): FilterApplyResult {
  switch (action.type) {
    case "draftChanged": {
      if (!action.valid) return { state, effects: state.live ? [CANCEL] : NONE };
      const dirty = !sameFilter(action.node, state.applied);
      const next = { ...state, draft: action.node, dirty };
      if (!state.live) return { state: next, effects: NONE };
      if (!dirty) return { state: next, effects: [CANCEL] };
      if (state.debounceMs === 0) return filterApplyReducer(next, { type: "apply" });
      return { state: next, effects: [{ type: "schedule", delay: state.debounceMs }] };
    }
    case "apply": {
      if (sameFilter(state.draft, state.applied)) {
        return { state: state.dirty ? { ...state, dirty: false } : state, effects: [CANCEL] };
      }
      return {
        state: { ...state, applied: state.draft, dirty: false },
        effects: [CANCEL, { type: "emit", filter: state.draft }],
      };
    }
    case "discard":
    case "reset":
      return { state: { ...state, draft: state.applied, dirty: false }, effects: [CANCEL] };
    case "appliedExternally": {
      if (sameFilter(action.node, state.applied)) return { state, effects: NONE };
      return { state: { ...state, applied: action.node, draft: action.node, dirty: false }, effects: [CANCEL] };
    }
    case "configChanged": {
      const { live, debounceMs } = resolveFilterApplyConfig(action.options);
      if (live === state.live && debounceMs === state.debounceMs) return { state, effects: NONE };
      const next = { ...state, live, debounceMs };
      if (!live) return { state: next, effects: [CANCEL] };
      if (!next.dirty) return { state: next, effects: NONE };
      if (debounceMs === 0) return filterApplyReducer(next, { type: "apply" });
      return { state: next, effects: [{ type: "schedule", delay: debounceMs }] };
    }
  }
}
