export type FilterPrimitive = string | number | boolean | null;

export type RelativeDateKind =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "lastNDays"
  | "nextNDays";

export interface RelativeDate {
  relative: RelativeDateKind;
  n?: number;
}

/** Half-open `[from, to)` range of ISO strings. */
export interface DateRange {
  from: string;
  to: string;
}

export interface FilterRangeValue {
  from: FilterPrimitive;
  to: FilterPrimitive;
}

export interface FilterMeValue {
  me: true;
}

export type FilterValue =
  | FilterPrimitive
  | FilterPrimitive[]
  | FilterRangeValue
  | RelativeDate
  | FilterMeValue;

export interface FilterCondition {
  columnId: string;
  operator: string;
  value?: FilterValue;
}

export interface FilterGroup {
  op: "and" | "or";
  children: FilterNode[];
}

export type FilterNode = FilterGroup | FilterCondition;
