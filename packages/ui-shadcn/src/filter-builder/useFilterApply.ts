import { useCallback, useEffect, useRef, useState } from "react";
import type { FilterNode } from "../internal/core-contracts";
import {
  type FilterApplyAction,
  type FilterApplyOptions,
  type FilterApplyState,
  countFilterChanges,
  filterApplyReducer,
  initFilterApplyState,
} from "./filterApplyModel";

export interface UseFilterApplyOptions extends FilterApplyOptions {
  /** The applied filter (controlled). A change that is not our own emission counts as `appliedExternally`. */
  value: FilterNode | null;
  /** Receives each applied filter. */
  onApply(filter: FilterNode | null): void;
}

export interface FilterApplyApi extends FilterApplyState {
  /** Conditions added/removed/edited but not applied yet. */
  pendingChanges: number;
  /** Report a draft edit; `valid` false keeps the last valid draft and never emits. */
  setDraft(node: FilterNode | null, valid?: boolean): void;
  apply(): void;
  discard(): void;
}

/** Wires `filterApplyReducer` to a debounce timer and `onApply`. */
export function useFilterApply(options: UseFilterApplyOptions): FilterApplyApi {
  const { value, onApply, mode, rowCount, liveFilterThreshold, debounceMs } = options;
  const [state, setState] = useState<FilterApplyState>(() =>
    initFilterApplyState(value, { mode, rowCount, liveFilterThreshold, debounceMs }),
  );
  const stateRef = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const dispatch = useCallback((action: FilterApplyAction) => {
    const { state: next, effects } = filterApplyReducer(stateRef.current, action);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
    for (const effect of effects) {
      if (effect.type === "cancel") clear();
      else if (effect.type === "schedule") {
        clear();
        timer.current = setTimeout(() => {
          timer.current = null;
          dispatch({ type: "apply" });
        }, effect.delay);
      } else onApplyRef.current(effect.filter);
    }
  }, [clear]);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) return;
    dispatch({ type: "appliedExternally", node: value });
  }, [value, dispatch]);

  useEffect(() => {
    if (!mounted.current) return;
    dispatch({ type: "configChanged", options: { mode, rowCount, liveFilterThreshold, debounceMs } });
  }, [mode, rowCount, liveFilterThreshold, debounceMs, dispatch]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clear();
    };
  }, [clear]);

  return {
    ...state,
    pendingChanges: countFilterChanges(state.applied, state.draft),
    setDraft: useCallback((node, valid = true) => dispatch({ type: "draftChanged", node, valid }), [dispatch]),
    apply: useCallback(() => dispatch({ type: "apply" }), [dispatch]),
    discard: useCallback(() => dispatch({ type: "discard" }), [dispatch]),
  };
}
