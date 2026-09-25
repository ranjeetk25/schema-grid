/**
 * Live-filter model for the FilterBuilder. Pure: no React, no DOM; timers are
 * injectable so the whole state machine is testable with fake timers.
 *
 * ## Apply modes
 *
 * - **live** — every edit is applied automatically after `debounceMs`
 *   (default 300ms). No Apply button.
 * - **explicit** — edits stay a local draft until the user presses
 *   "Apply filter" (or Enter in a value input); "Clear" drops everything.
 *
 * `resolveApplyMode` picks the mode: an explicit `live` override wins;
 * otherwise filtering is live while the row count is at or below the
 * threshold (`liveFilterThreshold`, default 5 000 rows in server mode and
 * 10 000 in client mode) and explicit above it. An unknown row count is live.
 *
 * ## Rules
 *
 * - Incomplete conditions (no column / operator, or a missing required value)
 *   are NEVER applied: `pruneIncomplete` strips them (and groups left empty)
 *   from what is emitted. A candidate that still fails core `validateFilter`
 *   (e.g. nested too deep) blocks applying altogether.
 * - An apply may return a Promise; if it rejects (or throws) the error is kept
 *   in state and the previously applied filter stays applied.
 * - An identical filter is never re-applied.
 */
import {
  type FieldTypeRegistry,
  type FilterCondition,
  type FilterNode,
  type GridSchema,
  getColumnOperators,
  isFilterGroup,
  validateFilter,
  valueMatchesKind,
} from "../internal/core-contracts";

export type FilterApplyMode = "live" | "explicit";

/** Server mode: above this many rows (the query total) filtering switches to explicit Apply. */
export const DEFAULT_SERVER_LIVE_FILTER_THRESHOLD = 5_000;
/** Client mode: above this many rows filtering switches to explicit Apply. */
export const DEFAULT_CLIENT_LIVE_FILTER_THRESHOLD = 10_000;
export const DEFAULT_LIVE_FILTER_DEBOUNCE_MS = 300;

export interface ApplyModeInput {
  /** Force live (`true`) or explicit (`false`) apply; wins over everything else. */
  live?: boolean;
  /** Where rows are filtered. Default `"client"`. */
  mode?: "client" | "server";
  /** Rows being filtered (client: loaded rows; server: the query total). Unknown → live. */
  rowCount?: number;
  /** Row count above which filtering is explicit. Default 5 000 (server) / 10 000 (client). */
  liveFilterThreshold?: number;
}

/** True when edits should apply automatically (see the module doc). */
export function shouldApplyLive(input: ApplyModeInput = {}): boolean {
  if (typeof input.live === "boolean") return input.live;
  const { rowCount } = input;
  if (typeof rowCount !== "number" || !Number.isFinite(rowCount)) return true;
  const threshold =
    input.liveFilterThreshold ??
    (input.mode === "server" ? DEFAULT_SERVER_LIVE_FILTER_THRESHOLD : DEFAULT_CLIENT_LIVE_FILTER_THRESHOLD);
  return rowCount <= threshold;
}

export function resolveApplyMode(input: ApplyModeInput = {}): FilterApplyMode {
  return shouldApplyLive(input) ? "live" : "explicit";
}

// ---------------------------------------------------------------------------
// Completeness / pruning
// ---------------------------------------------------------------------------

export interface PruneContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  /** When given, conditions on other columns are dropped too (never emit hidden columns). */
  readable?: ReadonlySet<string>;
}

/** A condition is complete when its column and operator exist and its value satisfies the operator. */
export function isComplete(cond: FilterCondition, ctx: PruneContext): boolean {
  if (!cond.columnId || !cond.operator) return false;
  if (ctx.readable && !ctx.readable.has(cond.columnId)) return false;
  const column = ctx.schema.columns.find((c) => c.id === cond.columnId);
  if (!column) return false;
  const op = getColumnOperators(column, ctx.registry).find((o) => o.id === cond.operator);
  if (!op) return false;
  return valueMatchesKind(op.valueKind, cond.value);
}

/** Drops incomplete conditions and the groups they leave empty; `null` when nothing remains. */
export function pruneIncomplete(node: FilterNode | null | undefined, ctx: PruneContext): FilterNode | null {
  if (!node) return null;
  if (!isFilterGroup(node)) return isComplete(node, ctx) ? node : null;
  const children: FilterNode[] = [];
  for (const child of node.children) {
    const kept = pruneIncomplete(child, ctx);
    if (kept) children.push(kept);
  }
  return children.length === 0 ? null : { op: node.op, children };
}

/**
 * What the builder may apply for a (possibly incomplete) AST: the pruned
 * filter, or `undefined` when the pruned filter still fails core validation.
 */
export function applicableFilter(node: FilterNode | null | undefined, ctx: PruneContext): FilterNode | null | undefined {
  const pruned = pruneIncomplete(node, ctx);
  if (!pruned) return null;
  const readable = ctx.readable ?? new Set(ctx.schema.columns.map((c) => c.id));
  return validateFilter(pruned, ctx.schema, ctx.registry, readable).length === 0 ? pruned : undefined;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export const filterKey = (node: FilterNode | null | undefined): string => JSON.stringify(node ?? null);

export type LiveFilterStatus = "idle" | "scheduled" | "applying" | "error";

export interface LiveFilterState {
  mode: FilterApplyMode;
  /** The filter currently applied (serialised). */
  appliedKey: string;
  /** The latest applicable draft: a filter, `null` (no conditions), or `undefined` (blocked / same as applied). */
  candidate: FilterNode | null | undefined;
  status: LiveFilterStatus;
  error: string | null;
  /** Explicit mode: the draft differs from what is applied. */
  dirty: boolean;
}

export type LiveFilterAction =
  /** The editor changed; `candidate` from `applicableFilter` (undefined = blocked). */
  | { type: "edit"; candidate: FilterNode | null | undefined }
  | { type: "applyStart" }
  | { type: "applySuccess"; key: string }
  | { type: "applyFailure"; error: string }
  /** The controlled value changed from outside. */
  | { type: "external"; value: FilterNode | null }
  | { type: "setMode"; mode: FilterApplyMode }
  | { type: "dismissError" };

export function initialLiveFilterState(value: FilterNode | null, mode: FilterApplyMode): LiveFilterState {
  return { mode, appliedKey: filterKey(value), candidate: undefined, status: "idle", error: null, dirty: false };
}

export function liveFilterReducer(state: LiveFilterState, action: LiveFilterAction): LiveFilterState {
  switch (action.type) {
    case "edit": {
      const { candidate } = action;
      const same = candidate !== undefined && filterKey(candidate) === state.appliedKey;
      if (candidate === undefined || same) {
        // Nothing (new) to apply. A blocked draft is still "dirty" in explicit mode.
        return {
          ...state,
          candidate: undefined,
          status: state.status === "applying" ? "applying" : "idle",
          dirty: state.mode === "explicit" && candidate === undefined ? state.dirty : false,
        };
      }
      if (state.mode === "live") return { ...state, candidate, status: state.status === "applying" ? "applying" : "scheduled", error: null };
      return { ...state, candidate, status: state.status === "applying" ? "applying" : "idle", dirty: true };
    }
    case "applyStart":
      return { ...state, status: "applying", error: null };
    case "applySuccess": {
      const stillPending = state.candidate !== undefined && filterKey(state.candidate) !== action.key;
      return {
        ...state,
        appliedKey: action.key,
        candidate: stillPending ? state.candidate : undefined,
        status: stillPending && state.mode === "live" ? "scheduled" : "idle",
        error: null,
        dirty: state.mode === "explicit" && stillPending,
      };
    }
    case "applyFailure":
      return { ...state, status: "error", error: action.error, dirty: state.mode === "explicit" };
    case "external":
      return { ...state, appliedKey: filterKey(action.value), candidate: undefined, status: "idle", error: null, dirty: false };
    case "setMode":
      return state.mode === action.mode ? state : { ...state, mode: action.mode, dirty: action.mode === "explicit" && state.candidate !== undefined };
    case "dismissError":
      return { ...state, error: null, status: state.status === "error" ? "idle" : state.status };
  }
}

// ---------------------------------------------------------------------------
// Controller (reducer + debounce + async apply)
// ---------------------------------------------------------------------------

export interface FilterTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const defaultFilterTimer: FilterTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface LiveFilterControllerOptions {
  value: FilterNode | null;
  mode: FilterApplyMode;
  /** Applies a filter. May return a Promise; a rejection keeps the previous filter and surfaces the error. */
  apply(node: FilterNode | null): unknown;
  debounceMs?: number;
  timer?: FilterTimer;
  onState?(state: LiveFilterState): void;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message || "Could not apply the filter" : typeof e === "string" && e ? e : "Could not apply the filter";

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v && (typeof v === "object" || typeof v === "function") && typeof (v as { then?: unknown }).then === "function";

/**
 * Drives `liveFilterReducer`: debounces live applies, runs explicit applies on
 * demand, tracks async applies (latest wins) and exposes the state.
 */
export class LiveFilterController {
  state: LiveFilterState;
  private handle: unknown = null;
  private seq = 0;
  /** Key of the filter currently being applied (between applyStart and its outcome). */
  private inflightKey: string | null = null;
  private readonly timer: FilterTimer;
  private readonly debounceMs: number;
  private options: LiveFilterControllerOptions;

  constructor(options: LiveFilterControllerOptions) {
    this.options = options;
    this.timer = options.timer ?? defaultFilterTimer;
    this.debounceMs = options.debounceMs ?? DEFAULT_LIVE_FILTER_DEBOUNCE_MS;
    this.state = initialLiveFilterState(options.value, options.mode);
  }

  /** Swap the apply callback / listener (e.g. new props) without resetting state. */
  update(options: Partial<Pick<LiveFilterControllerOptions, "apply" | "onState">>): void {
    this.options = { ...this.options, ...options };
  }

  private dispatch(action: LiveFilterAction): void {
    const next = liveFilterReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.options.onState?.(next);
  }

  private cancelTimer(): void {
    if (this.handle !== null) {
      this.timer.clear(this.handle);
      this.handle = null;
    }
  }

  private schedule(): void {
    this.cancelTimer();
    if (this.debounceMs <= 0) {
      this.flush();
      return;
    }
    this.handle = this.timer.set(() => {
      this.handle = null;
      this.flush();
    }, this.debounceMs);
  }

  /** The editor produced a new applicable filter (`undefined` = blocked). */
  edit(candidate: FilterNode | null | undefined): void {
    this.dispatch({ type: "edit", candidate });
    if (this.state.mode === "live" && this.state.status === "scheduled") this.schedule();
    else if (this.state.candidate === undefined) this.cancelTimer();
  }

  /** Applies the pending candidate now (Apply button / Enter / flush on close). */
  flush(): void {
    this.cancelTimer();
    const { candidate } = this.state;
    if (candidate === undefined) return;
    this.run(candidate);
  }

  /** Explicit "Clear": applies `null` immediately (any mode). */
  clear(): void {
    this.cancelTimer();
    this.dispatch({ type: "edit", candidate: null });
    if (this.state.candidate !== undefined) this.run(null);
  }

  private run(node: FilterNode | null): void {
    const key = filterKey(node);
    const seq = ++this.seq;
    this.inflightKey = key;
    this.dispatch({ type: "applyStart" });
    const done = () => {
      if (seq !== this.seq) return;
      this.inflightKey = null;
      this.dispatch({ type: "applySuccess", key });
      if (this.state.status === "scheduled") this.schedule();
    };
    const fail = (e: unknown) => {
      if (seq !== this.seq) return;
      this.inflightKey = null;
      this.dispatch({ type: "applyFailure", error: errorMessage(e) });
    };
    let result: unknown;
    try {
      result = this.options.apply(node);
    } catch (e) {
      fail(e);
      return;
    }
    if (isThenable(result)) result.then(done, fail);
    else done();
  }

  /**
   * The controlled value changed. Returns true when it is foreign (not the
   * applied / in-flight / pending filter) — the caller should reset its draft.
   */
  setValue(value: FilterNode | null): boolean {
    const key = filterKey(value);
    if (key === this.state.appliedKey) return false;
    if (key === this.inflightKey) return false;
    if (this.state.candidate !== undefined && key === filterKey(this.state.candidate)) return false;
    this.cancelTimer();
    this.seq++;
    this.inflightKey = null;
    this.dispatch({ type: "external", value });
    return true;
  }

  setMode(mode: FilterApplyMode): void {
    this.dispatch({ type: "setMode", mode });
    if (mode === "explicit") this.cancelTimer();
    else if (this.state.candidate !== undefined && this.state.status !== "applying") {
      this.dispatch({ type: "edit", candidate: this.state.candidate });
      this.schedule();
    }
  }

  dismissError(): void {
    this.dispatch({ type: "dismissError" });
  }

  /** Live mode: applies a scheduled (debouncing) edit right now. No-op otherwise. */
  flushScheduled(): void {
    if (this.state.mode === "live" && this.handle !== null) this.flush();
  }

  /** Stops timers. `flush: true` applies a scheduled live edit first (e.g. on unmount). */
  dispose({ flush = false }: { flush?: boolean } = {}): void {
    if (flush) this.flushScheduled();
    this.cancelTimer();
  }
}
