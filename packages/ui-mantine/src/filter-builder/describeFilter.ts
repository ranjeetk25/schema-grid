import {
  type ColumnDef,
  type FieldTypeRegistry,
  type FilterCondition,
  type FilterNode,
  type GridSchema,
  type RelativeDate,
  isFilterGroup,
  getColumnOperators,
} from "../internal/core-contracts";
import { type AccessMap, isReadable } from "../internal/access";
import { countConditions } from "./model";

const RELATIVE_TEXT: Record<RelativeDate["relative"], string> = {
  today: "today",
  yesterday: "yesterday",
  tomorrow: "tomorrow",
  thisWeek: "this week",
  lastWeek: "last week",
  thisMonth: "this month",
  lastMonth: "last month",
  lastNDays: "last N days",
  nextNDays: "next N days",
};

/** Lower-case phrase for a relative date, e.g. "yesterday", "last 7 days". */
export function humanizeRelativeDate(rd: RelativeDate): string {
  if ((rd.relative === "lastNDays" || rd.relative === "nextNDays") && typeof rd.n === "number") {
    const unit = rd.n === 1 ? "day" : "days";
    return `${rd.relative === "lastNDays" ? "last" : "next"} ${rd.n} ${unit}`;
  }
  return RELATIVE_TEXT[rd.relative] ?? String(rd.relative);
}

function formatter(column: ColumnDef | undefined, registry: FieldTypeRegistry): (v: unknown) => string {
  const type = column ? registry.get(column.type) : undefined;
  if (!column || !type) return (v) => String(v ?? "");
  const parsed = type.configSchema.safeParse(column.config ?? {});
  const config = parsed.success ? parsed.data : type.defaultConfig;
  if (column.type === "multiSelect") return (v) => type.format([v], config);
  return (v) => type.format(v, config);
}

/** Human label for a condition, e.g. "Payment status is not Paid". */
export function describeCondition(
  cond: FilterCondition,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  access?: AccessMap,
): string {
  // Never reveal a hidden column's label or values (e.g. from a shared saved view).
  if (access && !isReadable(access, cond.columnId)) return "Hidden column";
  const column = schema.columns.find((c) => c.id === cond.columnId);
  const label = column?.label ?? cond.columnId;
  const operator = column ? getColumnOperators(column, registry).find((o) => o.id === cond.operator) : undefined;
  const opLabel = operator?.label ?? cond.operator;
  const head = `${label} ${opLabel}`;
  const fmt = formatter(column, registry);
  const v = cond.value;

  switch (operator?.valueKind) {
    case "none":
    case "me":
      return head;
    case "multi":
      return `${head} ${(Array.isArray(v) ? v : []).map(fmt).join(", ")}`;
    case "range": {
      const r = v && typeof v === "object" && "from" in v ? v : { from: null, to: null };
      return `${head} ${fmt(r.from)} and ${fmt(r.to)}`;
    }
    case "relativeDate":
      return v && typeof v === "object" && "relative" in v ? `${head} ${humanizeRelativeDate(v)}` : head;
    default:
      if (v === undefined || v === null) return head;
      if (Array.isArray(v)) return `${head} ${v.map(fmt).join(", ")}`;
      if (typeof v === "object") return `${head} ${JSON.stringify(v)}`;
      return `${head} ${fmt(v)}`;
  }
}

/** A condition's label, or a group summary like "(2 conditions, OR)". */
export function describeNode(node: FilterNode, schema: GridSchema, registry: FieldTypeRegistry, access?: AccessMap): string {
  if (!isFilterGroup(node)) return describeCondition(node, schema, registry, access);
  const n = countConditions(node);
  return `(${n} ${n === 1 ? "condition" : "conditions"}, ${node.op.toUpperCase()})`;
}
