/**
 * A minimal external store primitive: no zustand, no context. State lives
 * outside React and is read via `useSyncExternalStore` through
 * `useStoreSelector`.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

export type StoreUpdater<S> = S | Partial<S> | ((state: S) => S | Partial<S>);

export interface Store<S> {
  getState(): S;
  setState(updater: StoreUpdater<S>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();

  const getState = (): S => state;

  const setState = (updater: StoreUpdater<S>): void => {
    const partial = typeof updater === "function" ? (updater as (state: S) => S | Partial<S>)(state) : updater;
    state = { ...state, ...partial } as S;
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { getState, setState, subscribe };
}

const defaultIsEqual = <T>(a: T, b: T): boolean => Object.is(a, b);

/**
 * Subscribes a component to one slice of a store, built on
 * `useSyncExternalStore`. The component only re-renders when the selected
 * slice changes according to `isEqual` (reference equality by default).
 */
export function useStoreSelector<S, T>(
  store: Store<S>,
  selector: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = defaultIsEqual,
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const cachedRef = useRef<{ value: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const next = selectorRef.current(store.getState());
    const cached = cachedRef.current;
    if (cached && isEqualRef.current(cached.value, next)) {
      return cached.value;
    }
    cachedRef.current = { value: next };
    return next;
  }, [store]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
