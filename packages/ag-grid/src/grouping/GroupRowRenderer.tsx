/**
 * Full-width group header row (32px): a chevron toggle (`aria-expanded`),
 * the group VALUE drawn with the column's own renderer from the UI registry
 * (badge, avatar, …; "(empty)" muted italic), a muted count, and right-aligned
 * aggregates as `label value` pairs. Indented 16px per level. Enter/Space on
 * the button or the focused row toggles; ArrowLeft/ArrowRight collapse/expand;
 * each change is announced ("Group Paid, 2 rows, collapsed"). Toggling goes
 * through `context.grouping` (client: expansion store; server: the lazy
 * groups controller).
 *
 * `FullWidthRowRenderer` is the single `fullWidthCellRenderer`; it dispatches
 * group rows here and load-more rows to `LoadMoreRowRenderer`.
 */
import type { CustomCellRendererProps } from "ag-grid-react";
import {
  Component,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import type { UiFieldTypeRegistry } from "../compile/uiRegistry";
import {
  type AggregationId,
  effectiveFieldType,
  type FieldTypeRegistry,
  type GridRow,
  type GridSchema,
  isEmptyValue,
} from "../internal/core";
import { type GroupDisplayRow, isGroupRow, isLoadMoreRow } from "./clientGroups";
import { getGroupingActions, isActivationKey, LoadMoreRowRenderer, useRowActivation } from "./LoadMoreRowRenderer";

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

export interface GroupAggregatePart {
  /** e.g. "Fee" for sums, "Avg Fee" / "Count Fee" otherwise. */
  label: string;
  value: string;
}

/**
 * Structured aggregates for the group row: `label value` pairs. Sums read as
 * the bare column label ("Fee ₹50,000"); other aggregates keep their name.
 */
export function groupAggregateParts(
  group: Pick<GroupDisplayRow, "aggregates">,
  schema: GridSchema | undefined,
  registry: FieldTypeRegistry | undefined,
): GroupAggregatePart[] {
  const texts = formatGroupAggregates(group, schema, registry);
  const keys = Object.keys(group.aggregates).filter((k) => k.lastIndexOf(":") >= 0);
  return keys.map((aggKey, i) => {
    const cut = aggKey.lastIndexOf(":");
    const columnId = aggKey.slice(0, cut);
    const agg = aggKey.slice(cut + 1);
    const columnLabel = schema?.columns.find((c) => c.id === columnId)?.label ?? columnId;
    const text = texts[i] ?? "";
    const value = text.slice(text.indexOf(": ") + 2);
    const name = AGG_LABELS[agg as AggregationId] ?? agg;
    return { label: agg === "sum" ? columnLabel : `${name} ${columnLabel}`, value };
  });
}

interface GroupRenderContext {
  schema?: GridSchema;
  registry?: FieldTypeRegistry;
  uiRegistry?: UiFieldTypeRegistry<GridRow>;
  announce?(message: string, politeness?: "polite" | "assertive"): void;
}

function groupContext(ctx: unknown): GroupRenderContext {
  if (!ctx || typeof ctx !== "object") return {};
  return ctx as GroupRenderContext;
}

/** Renders one value with a column renderer; falls back to text if it throws. */
class ValueBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Level-based indent (px) of a group row: 16px per level. */
export function groupRowIndent(level: number): number {
  return 12 + level * 16;
}

export function groupAnnouncement(label: string, count: number, expanded: boolean): string {
  return `Group ${label}, ${count} ${count === 1 ? "row" : "rows"}, ${expanded ? "expanded" : "collapsed"}`;
}

export function GroupRowRenderer<Row extends GridRow = GridRow>(props: CustomCellRendererProps<Row>) {
  const data = props.data as unknown as GroupDisplayRow | undefined;
  const actions = getGroupingActions(props.context);
  const ctx = groupContext(props.context);
  const isEmpty = !data || isEmptyValue(data.key);
  const labelText = data ? (isEmpty ? "(empty)" : data.label) : "";
  const setExpanded = (expanded: boolean) => {
    if (!data || data.expanded === expanded) return;
    actions?.toggle(data.id);
    ctx.announce?.(groupAnnouncement(labelText, data.count, expanded), "polite");
  };
  const toggle = () => {
    if (data) setExpanded(!data.expanded);
  };
  useRowActivation(props.eGridCell, toggle);
  const latest = useRef(setExpanded);
  latest.current = setExpanded;
  const eRow = props.eGridCell;
  useEffect(() => {
    if (!eRow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== eRow) return;
      if (event.key === "ArrowLeft") latest.current(false);
      else if (event.key === "ArrowRight") latest.current(true);
      else return;
      event.preventDefault();
    };
    eRow.addEventListener("keydown", onKeyDown);
    return () => eRow.removeEventListener("keydown", onKeyDown);
  }, [eRow]);
  if (!data) return null;
  const { schema, registry, uiRegistry } = ctx;
  const column = schema?.columns.find((c) => c.id === data.columnId);
  const columnLabel = column?.label ?? data.columnId;
  const aggregates = groupAggregateParts(data, schema, registry);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isActivationKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };

  let value: ReactNode = labelText;
  if (!isEmpty && column && uiRegistry?.has(column.type)) {
    const Renderer = uiRegistry.get(column.type).renderer as unknown as ComponentType<Record<string, unknown>>;
    const fieldType = registry ? effectiveFieldType(registry, column) : undefined;
    value = (
      <ValueBoundary fallback={labelText}>
        <Renderer
          value={data.key}
          valueFormatted={null}
          data={undefined}
          node={props.node}
          colDef={undefined}
          column={undefined}
          context={props.context}
          api={props.api}
          schemaColumn={column}
          fieldType={fieldType}
        />
      </ValueBoundary>
    );
  }

  return (
    <div
      className="sg-group-row"
      data-level={data.level}
      data-expanded={data.expanded || undefined}
      style={{ paddingLeft: groupRowIndent(data.level) }}
    >
      <button
        type="button"
        className="sg-group-toggle"
        aria-expanded={data.expanded}
        aria-label={`${data.expanded ? "Collapse" : "Expand"} group ${columnLabel}: ${labelText}`}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <ChevronIcon />
      </button>
      <span className={isEmpty ? "sg-group-label sg-group-empty" : "sg-group-label"} title={`${columnLabel}: ${labelText}`}>
        {value}
      </span>
      <span className="sg-group-sep" aria-hidden="true">
        ·
      </span>
      <span className="sg-group-count">{data.count.toLocaleString("en-US")}</span>
      {aggregates.length > 0 ? (
        <span className="sg-group-aggs">
          {aggregates.map((a, i) => (
            <span key={`${a.label}-${i}`} className="sg-group-agg">
              <span className="sg-group-agg-label">{a.label}</span> <span className="sg-group-agg-value">{a.value}</span>
            </span>
          ))}
        </span>
      ) : null}
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
