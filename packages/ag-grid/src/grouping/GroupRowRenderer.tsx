/**
 * Full-width group header row: a toggle button (`aria-expanded`), the
 * group's column + label, its row count and its aggregates, indented by
 * level. Enter/Space on the button, or on the focused full-width row, toggles
 * through `context.grouping` (client: expansion store; server: the lazy
 * groups controller).
 *
 * `FullWidthRowRenderer` is the single `fullWidthCellRenderer`; it dispatches
 * group rows here and load-more rows to `LoadMoreRowRenderer`.
 */
import type { CustomCellRendererProps } from "ag-grid-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  type AggregationId,
  effectiveFieldType,
  type FieldTypeRegistry,
  type GridRow,
  type GridSchema,
  isEmptyValue,
} from "../internal/core";
import { type GroupDisplayRow, isGroupRow, isLoadMoreRow } from "./clientGroups";
import { getGroupingActions, groupIndent, isActivationKey, LoadMoreRowRenderer, useRowActivation } from "./LoadMoreRowRenderer";

const AGG_LABELS: Record<AggregationId, string> = {
  count: "Count",
  sum: "Sum",
  avg: "Avg",
  min: "Min",
  max: "Max",
  countEmpty: "Empty",
  countFilled: "Filled",
};

const COUNT_AGGS: ReadonlySet<string> = new Set(["count", "countEmpty", "countFilled"]);

/**
 * "Sum Fee: ₹1,500.00" per aggregate. Counts print as numbers; every other
 * aggregate is formatted by the aggregated column's (effective) field type.
 */
export function formatGroupAggregates(
  group: Pick<GroupDisplayRow, "aggregates">,
  schema: GridSchema | undefined,
  registry: FieldTypeRegistry | undefined,
): string[] {
  const out: string[] = [];
  for (const [aggKey, value] of Object.entries(group.aggregates)) {
    const cut = aggKey.lastIndexOf(":");
    if (cut < 0) continue;
    const columnId = aggKey.slice(0, cut);
    const agg = aggKey.slice(cut + 1);
    const column = schema?.columns.find((c) => c.id === columnId);
    const name = AGG_LABELS[agg as AggregationId] ?? agg;
    let text: string;
    if (isEmptyValue(value)) text = "—";
    else if (COUNT_AGGS.has(agg) || !column || !registry) text = typeof value === "number" ? value.toLocaleString("en-US") : String(value);
    else {
      const fieldType = effectiveFieldType(registry, column);
      const config = column.type === "formula" ? fieldType?.defaultConfig : (column.config ?? fieldType?.defaultConfig);
      try {
        text = fieldType ? fieldType.format(value, config) : String(value);
      } catch {
        text = String(value);
      }
    }
    out.push(`${name} ${column?.label ?? columnId}: ${text}`);
  }
  return out;
}

function contextSchema(ctx: unknown): { schema?: GridSchema; registry?: FieldTypeRegistry } {
  if (!ctx || typeof ctx !== "object") return {};
  const c = ctx as { schema?: GridSchema; registry?: FieldTypeRegistry };
  return { ...(c.schema ? { schema: c.schema } : {}), ...(c.registry ? { registry: c.registry } : {}) };
}

export function GroupRowRenderer<Row extends GridRow = GridRow>(props: CustomCellRendererProps<Row>) {
  const data = props.data as unknown as GroupDisplayRow | undefined;
  const actions = getGroupingActions(props.context);
  const toggle = () => {
    if (data) actions?.toggle(data.id);
  };
  useRowActivation(props.eGridCell, toggle);
  if (!data) return null;
  const { schema, registry } = contextSchema(props.context);
  const columnLabel = schema?.columns.find((c) => c.id === data.columnId)?.label ?? data.columnId;
  const aggregates = formatGroupAggregates(data, schema, registry);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isActivationKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };
  return (
    <div className="sg-group-row" data-level={data.level} style={{ paddingLeft: groupIndent(data.level) }}>
      <button
        type="button"
        className="sg-group-toggle"
        aria-expanded={data.expanded}
        aria-label={`${data.expanded ? "Collapse" : "Expand"} group ${columnLabel}: ${data.label}`}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden="true">{data.expanded ? "▾" : "▸"}</span>
      </button>
      <span className="sg-group-label">
        <span className="sg-group-column">{columnLabel}:</span> {data.label}
      </span>
      <span className="sg-group-count"> ({data.count})</span>
      {aggregates.length > 0 ? <span className="sg-group-aggs"> {aggregates.join(" · ")}</span> : null}
    </div>
  );
}

/** The one `fullWidthCellRenderer`: group rows and load-more rows. */
export function FullWidthRowRenderer<Row extends GridRow = GridRow>(props: CustomCellRendererProps<Row>) {
  const data = props.data as unknown;
  if (data && isLoadMoreRow(data)) return <LoadMoreRowRenderer<Row> {...props} />;
  if (data && isGroupRow(data)) return <GroupRowRenderer<Row> {...props} />;
  return null;
}
