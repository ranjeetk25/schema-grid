/**
 * Row classes for grouped display: group header rows carry `sg-row-group`
 * + `sg-row-group-l{level}`; data rows under a grouping carry
 * `sg-row-grouped` + `sg-row-grouped-l{depth}` (depth = number of group
 * levels), which the theme CSS uses to indent their first displayed cell
 * 24px per level. Group depth comes from `context.stores.query` (groupBy).
 */
import type { RowClassParams, RowClassRules, RowHeightParams } from "ag-grid-community";
import type { GridRow } from "../internal/core";
import { isGroupRow, isLoadMoreRow } from "./clientGroups";

export const MAX_GROUP_CLASS_LEVEL = 5;
/** Height of group header and load-more rows (data rows keep the theme's 36px). */
export const GROUP_ROW_HEIGHT = 32;

interface QueryLike {
  stores?: { query?: { getState(): { groupBy: readonly unknown[] } } };
}

function groupDepth(context: unknown): number {
  const q = (context as QueryLike | undefined)?.stores?.query;
  return q ? q.getState().groupBy.length : 0;
}

function asDisplay(data: unknown) {
  return data as Parameters<typeof isGroupRow>[0];
}

export function createGroupingRowClassRules<Row extends GridRow = GridRow>(): RowClassRules<Row> {
  const rules: RowClassRules<Row> = {
    "sg-row-group": (p: RowClassParams<Row>) => !!p.data && isGroupRow(asDisplay(p.data)),
    "sg-row-grouped": (p: RowClassParams<Row>) =>
      !!p.data && !isGroupRow(asDisplay(p.data)) && !isLoadMoreRow(asDisplay(p.data)) && groupDepth(p.context) > 0,
  };
  for (let level = 0; level <= MAX_GROUP_CLASS_LEVEL; level++) {
    rules[`sg-row-group-l${level}`] = (p: RowClassParams<Row>) => {
      const d = p.data ? asDisplay(p.data) : undefined;
      return !!d && isGroupRow(d) && Math.min(d.level, MAX_GROUP_CLASS_LEVEL) === level;
    };
    if (level > 0) {
      rules[`sg-row-grouped-l${level}`] = (p: RowClassParams<Row>) => {
        const d = p.data ? asDisplay(p.data) : undefined;
        if (!d || isGroupRow(d) || isLoadMoreRow(d)) return false;
        return Math.min(groupDepth(p.context), MAX_GROUP_CLASS_LEVEL) === level;
      };
    }
  }
  return rules;
}

/** `getRowHeight`: 32px for group/load-more rows, the theme default otherwise. */
export function groupingRowHeight<Row extends GridRow = GridRow>(p: RowHeightParams<Row>): number | undefined {
  const d = p.data ? asDisplay(p.data) : undefined;
  return d && (isGroupRow(d) || isLoadMoreRow(d)) ? GROUP_ROW_HEIGHT : undefined;
}
