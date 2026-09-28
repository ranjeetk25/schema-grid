/**
 * Per-person permissions (v0.4): the host's user directory, a per-directory
 * name cache and the "Priya, Rahul" / "5 people" wording shared by the
 * access section and the option "Who can set" control.
 */
import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from "react";
import type { ActorRef } from "./core-contracts";

/** Looks people up for the column panel's People pickers. */
export interface UserDirectory {
  /** People matching `query` (`""` = a first page), for the picker's async search. */
  search(query: string): Promise<ActorRef[]>;
  /** Names for stored ids; ids it does not return show as the raw id, marked "unknown user". */
  resolve(ids: string[]): Promise<ActorRef[]>;
}

/** id → display name; `null` = unknown to the directory; absent = not resolved (yet). */
export type PeopleNames = ReadonlyMap<string, string | null>;

const EMPTY_NAMES: PeopleNames = new Map();

interface DirectoryCache {
  names: Map<string, string | null>;
  /** Ids with a `resolve` in flight (each id is asked for once). */
  pending: Set<string>;
  /** Re-renders every `usePeopleNames` on this directory when names arrive. */
  listeners: Set<() => void>;
}

const caches = new WeakMap<UserDirectory, DirectoryCache>();
const cacheOf = (directory: UserDirectory): DirectoryCache => {
  let cache = caches.get(directory);
  if (!cache) {
    cache = { names: new Map(), pending: new Set(), listeners: new Set() };
    caches.set(directory, cache);
  }
  return cache;
};

/** Remembers names the directory already gave (e.g. search results), so picking someone needs no `resolve`. */
export function rememberPeople(directory: UserDirectory | undefined, people: readonly ActorRef[]): void {
  if (!directory) return;
  const { names } = cacheOf(directory);
  for (const p of people) names.set(p.id, p.name?.trim() || p.id);
}

/**
 * Names for `ids` via `directory.resolve` (cached per directory; each id is
 * asked for once). Without a directory every id is unresolved.
 */
export function usePeopleNames(directory: UserDirectory | undefined, ids: readonly string[]): PeopleNames {
  const [, setVersion] = useState(0);
  const key = [...new Set(ids)].sort().join("\u0000");
  useEffect(() => {
    if (!directory) return;
    const cache = cacheOf(directory);
    const rerender = () => setVersion((v) => v + 1);
    cache.listeners.add(rerender);
    const missing = key === "" ? [] : key.split("\u0000").filter((id) => !cache.names.has(id) && !cache.pending.has(id));
    if (missing.length > 0) {
      for (const id of missing) cache.pending.add(id);
      const settle = (people: readonly ActorRef[] | null) => {
        if (people) rememberPeople(directory, people);
        for (const id of missing) {
          cache.pending.delete(id);
          // Not returned → unknown user; a failed lookup leaves the ids unresolved (raw ids, unmarked).
          if (people && !cache.names.has(id)) cache.names.set(id, null);
        }
        for (const listener of cache.listeners) listener();
      };
      directory.resolve(missing).then(settle, () => settle(null));
    }
    return () => {
      cache.listeners.delete(rerender);
    };
  }, [directory, key]);
  return directory ? cacheOf(directory).names : EMPTY_NAMES;
}

/** The name for `id`, else the raw id. */
export const personName = (names: PeopleNames, id: string): string => names.get(id) ?? id;

/** "Priya, Rahul" (up to 3 names), else "5 people"; `""` for none. */
export function peopleList(ids: readonly string[], names: PeopleNames = EMPTY_NAMES): string {
  if (ids.length > 3) return `${ids.length} people`;
  return ids.map((id) => personName(names, id)).join(", ");
}

const UserDirectoryContext = createContext<UserDirectory | undefined>(undefined);

/** Makes a `UserDirectory` available to option lists deep inside the column form's config section. */
export function UserDirectoryProvider({ value, children }: { value: UserDirectory | undefined; children: ReactNode }) {
  return createElement(UserDirectoryContext.Provider, { value }, children);
}

export const useUserDirectory = (): UserDirectory | undefined => useContext(UserDirectoryContext);
