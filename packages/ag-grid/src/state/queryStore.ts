/**
 * The query store: the single source of truth for filter, sort, search,
 * grouping and (v0.4) the view's color rules. Column filters, header sorting
 * and the toolbar are views onto it.
 */
import type { ColorRule, FilterNode, GroupSpec, SortSpec } from "../internal/core";
import { type Store, createStore } from "./createStore";

export interface QueryState {
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  groupBy: GroupSpec[];
  /**
   * v0.4: the view's color rules, in order (absent = none). They color cells
   * and feed `colorIs` / `colorIsNone` filtering (`GridQuery.colorRules`).
   */
  colorRules?: ColorRule[];
}

export interface QueryStore extends Store<QueryState> {
  setFilter(filter: FilterNode | null): void;
  setSort(sort: SortSpec[]): void;
  /** Empty / whitespace-only search clears it. */
  setSearch(search: string | undefined): void;
  setGroupBy(groupBy: GroupSpec[]): void;
  /** v0.4: an empty list clears the rules. */
  setColorRules(colorRules: ColorRule[]): void;
}

export const EMPTY_QUERY_STATE: QueryState = { filter: null, sort: [], groupBy: [] };

export function createQueryStore(initial?: Partial<QueryState>): QueryStore {
  const store = createStore<QueryState>({
    filter: initial?.filter ?? null,
    sort: initial?.sort ?? [],
    groupBy: initial?.groupBy ?? [],
    ...(initial?.search !== undefined ? { search: initial.search } : {}),
    ...(initial?.colorRules && initial.colorRules.length > 0 ? { colorRules: initial.colorRules } : {}),
  });
  return {
    ...store,
    setFilter: (filter) => store.setState({ filter }),
    setSort: (sort) => store.setState({ sort }),
    setSearch: (search) => store.setState({ search: search?.trim() ? search : undefined }),
    setGroupBy: (groupBy) => store.setState({ groupBy }),
    setColorRules: (colorRules) => store.setState({ colorRules: colorRules.length > 0 ? colorRules : undefined }),
  };
}
