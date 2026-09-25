import type { GridRow } from "../rows/types";
import type { FilterNode } from "../filter/types";

export interface SortSpec {
  columnId: string;
  dir: "asc" | "desc";
}

export type AggregationId =
  | "count"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "countEmpty"
  | "countFilled";

export interface GroupSpec {
  columnId: string;
  aggregations?: { columnId: string; agg: AggregationId }[];
}

export type PageRequest =
  | { offset: number; limit: number; cursor?: never }
  | { cursor: string; limit: number; offset?: never };

export interface GridQuery {
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  groupBy?: GroupSpec[];
  page: PageRequest;
  includeTotal?: boolean;
}

export interface GroupAggregateValue {
  columnId: string;
  agg: AggregationId;
  value: number | string | null;
}

export interface GroupResult {
  columnId: string;
  value: unknown;
  key: string;
  count: number;
  aggregates: GroupAggregateValue[];
  children?: GroupResult[];
}

export interface QueryResult<Row extends GridRow = GridRow> {
  rows: Row[];
  total?: number;
  nextCursor?: string;
  groups?: GroupResult[];
}
