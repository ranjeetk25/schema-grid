/**
 * The query store: the single source of truth for filter, sort, search and
 * grouping. Column filters, header sorting and the toolbar are views onto it.
 */
import type { FilterNode, GroupSpec, SortSpec } from "../internal/core";
import { type Store, createStore } from "./createStore";

export interface QueryState {
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  groupBy: GroupSpec[];
}

export interface QueryStore extends Store<QueryState> {
  setFilter(filter: FilterNode | null): void;
  setSort(sort: SortSpec[]): void;
  /** Empty / whitespace-only search clears it. */
  setSearch(search: string | undefined): void;
  setGroupBy(groupBy: GroupSpec[]): void;
}

export const EMPTY_QUERY_STATE: QueryState = { filter: null, sort: [], groupBy: [] };

export function createQueryStore(initial?: Partial<QueryState>): QueryStore {
  const store = createStore<QueryState>({
    filter: initial?.filter ?? null,
    sort: initial?.sort ?? [],
    groupBy: initial?.groupBy ?? [],
    ...(initial?.search !== undefined ? { search: initial.search } : {}),
  });
  return {
    ...store,
    setFilter: (filter) => store.setState({ filter }),
    setSort: (sort) => store.setState({ sort }),
    setSearch: (search) => store.setState({ search: search?.trim() ? search : undefined }),
    setGroupBy: (groupBy) => store.setState({ groupBy }),
  };
}
