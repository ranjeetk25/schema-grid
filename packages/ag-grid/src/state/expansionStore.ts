/**
 * Tracks which group ids are expanded/collapsed. Built on the generic
 * `createStore` primitive so it can be read via `useStoreSelector` in React
 * or polled directly (e.g. from `buildClientGroups`).
 */
import { createStore } from "./createStore";

export interface ExpansionState {
  defaultExpanded: boolean;
  overrides: Record<string, boolean>;
}

export interface ExpansionStore {
  toggle(id: string): void;
  setExpanded(id: string, expanded: boolean): void;
  isExpanded(id: string): boolean;
  expandAll(expanded: boolean): void;
  subscribe(listener: () => void): () => void;
  getState(): ExpansionState;
}

export interface CreateExpansionStoreOptions {
  defaultExpanded?: boolean;
}

export function createExpansionStore(options: CreateExpansionStoreOptions = {}): ExpansionStore {
  const { defaultExpanded = true } = options;
  const store = createStore<ExpansionState>({ defaultExpanded, overrides: {} });

  const isExpanded = (id: string): boolean => {
    const state = store.getState();
    return state.overrides[id] ?? state.defaultExpanded;
  };

  const setExpanded = (id: string, expanded: boolean): void => {
    store.setState((state) => ({ overrides: { ...state.overrides, [id]: expanded } }));
  };

  const toggle = (id: string): void => {
    setExpanded(id, !isExpanded(id));
  };

  const expandAll = (expanded: boolean): void => {
    store.setState({ defaultExpanded: expanded, overrides: {} });
  };

  return {
    toggle,
    setExpanded,
    isExpanded,
    expandAll,
    subscribe: store.subscribe,
    getState: store.getState,
  };
}
