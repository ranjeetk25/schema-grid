import type { IFilter } from "ag-grid-community";
import type { CustomFloatingFilterProps } from "ag-grid-react";
import type { FilterCondition, FilterPrimitive, FilterValue, GridRow } from "../internal/core";
import { configOptions, RELATIVE_DATE_LABELS, type ResolvedFilterColumn, resolveFilterColumn } from "./ConditionFilter";

/**
 * Optional key a grid may put on its `context` (alongside `SchemaGridContext`)
 * so floating filters can flag columns whose conditions live in the compound
 * filter's residual (OR groups, repeats) — see `astToFilterModel`.
 */
export interface FilterContextExtras {
  advancedColumnIds?: () => ReadonlySet<string>;
}

export type SchemaFloatingFilterProps<Row extends GridRow = GridRow> = CustomFloatingFilterProps<
  IFilter,
  Row,
  unknown,
  FilterCondition
>;

function isAdvanced(context: unknown, columnId: string): boolean {
  if (!context || typeof context !== "object") return false;
  const fn = (context as FilterContextExtras).advancedColumnIds;
  if (typeof fn !== "function") return false;
  return fn().has(columnId);
}

function formatPrimitive(resolved: ResolvedFilterColumn, v: FilterPrimitive): string {
  if (v === null) return "";
  const options = configOptions(resolved.config);
  if (options.length > 0) {
    const found = options.find((o) => o.id === String(v));
    if (found) return found.label;
  }
  const { fieldType, config } = resolved;
  if (typeof v === "number" && (fieldType.id === "number" || fieldType.id === "currency")) {
    try {
      return fieldType.format(v, config);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function formatValue(resolved: ResolvedFilterColumn, value: FilterValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((v) => formatPrimitive(resolved, v)).join(", ");
  if (typeof value === "object") {
    if ("me" in value) return "";
    if ("relative" in value) {
      if (value.relative === "lastNDays") return `last ${value.n ?? "?"} days`;
      if (value.relative === "nextNDays") return `next ${value.n ?? "?"} days`;
      return RELATIVE_DATE_LABELS[value.relative].toLowerCase();
    }
    const from = formatPrimitive(resolved, value.from);
    const to = formatPrimitive(resolved, value.to);
    if (from && to) return `${from} – ${to}`;
    return from ? `≥ ${from}` : `≤ ${to}`;
  }
  return formatPrimitive(resolved, value);
}

/** `{label} {operatorLabel} {formatted value}` — the text the floating chip shows. */
export function summarizeCondition(resolved: ResolvedFilterColumn, condition: FilterCondition): string {
  const opLabel = resolved.operators.find((o) => o.id === condition.operator)?.label ?? condition.operator;
  const value = formatValue(resolved, condition.value);
  return [resolved.column.label, opLabel, value].filter((s) => s !== "").join(" ");
}

/**
 * Read-only floating filter: a summary chip of the column's condition with a
 * clear (×) button, or an "Advanced" badge when the column's conditions live
 * in the compound builder (`context.advancedColumnIds`).
 */
export function FloatingFilter<Row extends GridRow = GridRow>(props: SchemaFloatingFilterProps<Row>) {
  const { model, onModelChange } = props;
  const column = props.column as Parameters<typeof resolveFilterColumn>[0]["column"];
  const resolved = resolveFilterColumn({ column });
  const columnId = resolved?.columnId ?? props.column?.getColId?.();
  const advanced = columnId !== undefined && isAdvanced(props.context, columnId);

  if (!resolved) return null;

  return (
    <div className="sg-floating-filter">
      {model && (
        <span className="sg-filter-chip" title={summarizeCondition(resolved, model)}>
          <span className="sg-filter-chip-text">{summarizeCondition(resolved, model)}</span>
          <button type="button" aria-label="Clear filter" className="sg-filter-chip-clear" onClick={() => onModelChange(null)}>
            ×
          </button>
        </span>
      )}
      {advanced && <span className="sg-filter-advanced">Advanced</span>}
    </div>
  );
}
