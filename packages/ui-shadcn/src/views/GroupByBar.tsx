import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, PlusIcon, Rows3Icon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { type AccessMap, readableColumns } from "../internal/access";
import {
  type AggregationId,
  type ColumnDef,
  type FieldTypeRegistry,
  type GridSchema,
  type GroupSpec,
  getColumnAggregations,
  getColumnValueFieldType,
} from "../internal/core-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { ComboboxPicker, FieldTypeIcon, SelectField } from "../filter-builder/pickers";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";

export interface GroupByBarProps {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: AccessMap;
  value: GroupSpec[];
  onChange(next: GroupSpec[]): void;
  maxGroups?: number;
  /** Button label. Default "Group". */
  label?: string;
  /** Render the popover in place instead of portalling. */
  portalled?: boolean;
  className?: string;
}

const AGG_LABELS: Record<AggregationId, string> = {
  count: "Count",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
  countEmpty: "Count empty",
  countFilled: "Count filled",
};

const NO_SUMMARY = "__no_summary__";

const NON_GROUPABLE = new Set(["longText"]);

const NUMERIC_VALUE_TYPES = new Set(["number", "currency"]);

/**
 * Aggregations for numeric columns only (number, currency, or a formula whose
 * `config.resultType` is number), as core's `getColumnAggregations` reports them.
 */
function aggregationsFor(column: ColumnDef, registry: FieldTypeRegistry): readonly AggregationId[] {
  const valueType = getColumnValueFieldType(column, registry)?.id;
  if (!valueType || !NUMERIC_VALUE_TYPES.has(valueType)) return [];
  return getColumnAggregations(column, registry);
}

/**
 * Airtable/Linear-style grouping control: ONE "Group" button (count badge when
 * active) opening a popover with the group columns as ordered, removable rows,
 * an "Add group" picker (readable, not-yet-grouped, groupable columns only) and
 * a collapsed "Summaries" section of per-column aggregations. Aggregations
 * always live on the FIRST group spec, as in ui-mantine.
 */
export function GroupByBar({
  schema,
  registry,
  access,
  value,
  onChange,
  maxGroups = 3,
  label = "Group",
  portalled = true,
  className,
}: GroupByBarProps) {
  const [summariesOpen, setSummariesOpen] = useState(false);
  const summariesId = useId();
  const readable = readableColumns(schema, access);
  const byId = new Map(readable.map((c) => [c.id, c]));
  const used = new Set(value.map((g) => g.columnId));
  const addable = readable.filter((c) => !used.has(c.id) && !NON_GROUPABLE.has(c.type));
  const numeric = readable.map((c) => ({ column: c, aggs: aggregationsFor(c, registry) })).filter((x) => x.aggs.length > 0);
  const aggregations = value[0]?.aggregations ?? [];
  const atMax = value.length >= maxGroups;

  const withAggregations = (groups: GroupSpec[], aggs: GroupSpec["aggregations"]): GroupSpec[] =>
    groups.map((g, i) => {
      const { aggregations: _drop, ...rest } = g;
      return i === 0 && aggs && aggs.length > 0 ? { ...rest, aggregations: aggs } : rest;
    });

  const add = (columnId: string) => {
    if (atMax) return;
    onChange(withAggregations([...value, { columnId }], aggregations));
  };

  const remove = (columnId: string) => {
    onChange(withAggregations(value.filter((g) => g.columnId !== columnId), aggregations));
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target] as GroupSpec, next[index] as GroupSpec];
    onChange(withAggregations(next, aggregations));
  };

  const setAgg = (columnId: string, agg: AggregationId | null) => {
    const others = aggregations.filter((a) => a.columnId !== columnId);
    onChange(withAggregations(value, agg ? [...others, { columnId, agg }] : others));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" className={cn(SG_ROOT, className)} aria-haspopup="dialog">
          <Rows3Icon aria-hidden className="sg:size-4 sg:text-muted-foreground" />
          {label}
          {value.length > 0 ? (
            <Badge variant="primary" data-testid="group-count" className="sg:min-w-5 sg:justify-center sg:rounded-full sg:px-1.5">
              {value.length}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent portalled={portalled} aria-label="Group by" className="sg:w-[360px] sg:max-w-[calc(100vw-16px)] sg:p-0">
        <div className="sg:flex sg:flex-col sg:gap-3 sg:p-4">
          <h3 className="sg:m-0 sg:text-sm sg:font-semibold">Group by</h3>

          {value.length === 0 ? (
            <p className="sg:m-0 sg:text-sm sg:text-muted-foreground">No grouping</p>
          ) : (
            <ol aria-label="Group columns" className="sg:m-0 sg:flex sg:list-none sg:flex-col sg:gap-1 sg:p-0">
              {value.map((g, i) => {
                const column = byId.get(g.columnId);
                const name = column?.label ?? "Hidden column";
                return (
                  <li
                    key={g.columnId}
                    className="sg:flex sg:h-8 sg:items-center sg:gap-2 sg:rounded-md sg:border sg:border-border sg:bg-background sg:pr-1 sg:pl-2"
                  >
                    <span className="sg:w-3 sg:text-xs sg:text-faint-foreground sg:tabular-nums">{i + 1}</span>
                    {column ? <FieldTypeIcon type={column.type} /> : null}
                    <span className="sg:min-w-0 sg:flex-1 sg:truncate sg:text-sm">{name}</span>
                    <Button
                      variant="subtle"
                      size="icon-xs"
                      aria-label={`Move ${name} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUpIcon aria-hidden />
                    </Button>
                    <Button
                      variant="subtle"
                      size="icon-xs"
                      aria-label={`Move ${name} down`}
                      disabled={i === value.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDownIcon aria-hidden />
                    </Button>
                    <Tooltip content="Remove">
                      <Button variant="subtle" size="icon-xs" aria-label={`Remove group ${name}`} onClick={() => remove(g.columnId)}>
                        <XIcon aria-hidden />
                      </Button>
                    </Tooltip>
                  </li>
                );
              })}
            </ol>
          )}

          <div>
            <ComboboxPicker
              aria-label="Add group"
              placeholder="Add group"
              searchPlaceholder="Search columns…"
              emptyText="No columns to group by"
              items={addable.map((c) => ({ value: c.id, label: c.label, icon: <FieldTypeIcon type={c.type} /> }))}
              value={null}
              onChange={add}
              disabled={atMax || addable.length === 0}
              triggerVariant="ghost"
              size="sm"
              className="sg:text-muted-foreground sg:hover:text-foreground"
              trigger={
                <span className="sg:flex sg:items-center sg:gap-1.5">
                  <PlusIcon aria-hidden className="sg:size-3.5" />
                  Add group
                </span>
              }
            />
            {atMax ? <p className="sg:mt-1 sg:text-xs sg:text-muted-foreground">{`Up to ${maxGroups} levels of grouping`}</p> : null}
          </div>
        </div>

        {value.length > 0 && numeric.length > 0 ? (
          <div className="sg:border-t sg:border-border">
            <button
              type="button"
              aria-expanded={summariesOpen}
              aria-controls={summariesId}
              onClick={() => setSummariesOpen((o) => !o)}
              className="sg:flex sg:h-10 sg:w-full sg:items-center sg:gap-1.5 sg:px-4 sg:text-sm sg:font-medium sg:text-foreground sg:outline-none sg:hover:bg-subtle sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring sg:focus-visible:ring-inset"
            >
              <ChevronRightIcon
                aria-hidden
                className={cn("sg:size-3.5 sg:text-muted-foreground sg:transition-transform sg:duration-150", summariesOpen && "sg:rotate-90")}
              />
              Summaries
              {aggregations.length > 0 ? (
                <span className="sg:ml-auto sg:text-xs sg:font-normal sg:text-muted-foreground sg:tabular-nums">{aggregations.length}</span>
              ) : null}
            </button>
            {summariesOpen ? (
              <div id={summariesId} className="sg:flex sg:flex-col sg:gap-2 sg:px-4 sg:pb-4">
                {numeric.map(({ column, aggs }) => (
                  <div key={column.id} className="sg:flex sg:items-center sg:gap-2">
                    <FieldTypeIcon type={column.type} />
                    <span className="sg:min-w-0 sg:flex-1 sg:truncate sg:text-sm">{column.label}</span>
                    <SelectField
                      aria-label={`Aggregate ${column.label}`}
                      size="sm"
                      className="sg:w-36"
                      value={aggregations.find((a) => a.columnId === column.id)?.agg ?? NO_SUMMARY}
                      items={[{ value: NO_SUMMARY, label: "No summary" }, ...aggs.map((a) => ({ value: a, label: AGG_LABELS[a] }))]}
                      onChange={(v) => setAgg(column.id, v === NO_SUMMARY ? null : (v as AggregationId))}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
