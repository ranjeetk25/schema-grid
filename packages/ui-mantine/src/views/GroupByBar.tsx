import { CloseButton, Group, Pill, Select, Text } from "@mantine/core";
import { type AccessMap, readableColumns } from "../internal/access";
import {
  type AggregationId,
  type ColumnDef,
  type FieldTypeRegistry,
  type GridSchema,
  type GroupSpec,
  inferResultType,
  isFormulaError,
  parseFormula,
} from "../internal/core-contracts";

export interface GroupByBarProps {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: AccessMap;
  value: GroupSpec[];
  onChange(next: GroupSpec[]): void;
  maxGroups?: number;
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

const NON_GROUPABLE = new Set(["longText"]);

/** Aggregations for number/currency, or a formula whose result type is number. */
function aggregationsFor(column: ColumnDef, schema: GridSchema, registry: FieldTypeRegistry): AggregationId[] {
  if (column.type === "formula") {
    const ast = column.formula ? parseFormula(column.formula) : null;
    if (!ast || isFormulaError(ast) || inferResultType(ast, schema) !== "number") return [];
    return registry.get("number")?.aggregations ?? [];
  }
  if (column.type !== "number" && column.type !== "currency") return [];
  return registry.get(column.type)?.aggregations ?? [];
}

export function GroupByBar({ schema, registry, access, value, onChange, maxGroups = 3 }: GroupByBarProps) {
  const readable = readableColumns(schema, access);
  const byId = new Map(readable.map((c) => [c.id, c]));
  const used = new Set(value.map((g) => g.columnId));
  const addable = readable.filter((c) => !used.has(c.id) && !NON_GROUPABLE.has(c.type));
  const numeric = readable
    .map((c) => ({ column: c, aggs: aggregationsFor(c, schema, registry) }))
    .filter((x) => x.aggs.length > 0);
  const aggregations = value[0]?.aggregations ?? [];

  const withAggregations = (groups: GroupSpec[], aggs: GroupSpec["aggregations"]): GroupSpec[] =>
    groups.map((g, i) => {
      const { aggregations: _drop, ...rest } = g;
      return i === 0 && aggs && aggs.length > 0 ? { ...rest, aggregations: aggs } : rest;
    });

  const add = (columnId: string | null) => {
    if (!columnId || value.length >= maxGroups) return;
    onChange(withAggregations([...value, { columnId }], aggregations));
  };

  const remove = (columnId: string) => {
    onChange(withAggregations(value.filter((g) => g.columnId !== columnId), aggregations));
  };

  const setAgg = (columnId: string, agg: AggregationId | null) => {
    const others = aggregations.filter((a) => a.columnId !== columnId);
    onChange(withAggregations(value, agg ? [...others, { columnId, agg }] : others));
  };

  return (
    <Group gap="xs" wrap="wrap" align="center">
      <Text size="sm" fw={500}>
        Group by
      </Text>
      {value.map((g) => {
        const label = byId.get(g.columnId)?.label ?? g.columnId;
        return (
          <Pill key={g.columnId} size="md">
            <Group gap={4} wrap="nowrap">
              <span>{label}</span>
              <CloseButton size="xs" aria-label={`Remove group ${label}`} onClick={() => remove(g.columnId)} />
            </Group>
          </Pill>
        );
      })}
      <Select
        aria-label="Add group"
        placeholder="Add group"
        size="xs"
        w={180}
        value={null}
        data={addable.map((c) => ({ value: c.id, label: c.label }))}
        onChange={add}
        disabled={value.length >= maxGroups || addable.length === 0}
        searchable
        comboboxProps={{ withinPortal: false }}
      />
      {value.length > 0 &&
        numeric.map(({ column, aggs }) => (
          <Select
            key={column.id}
            aria-label={`Aggregate ${column.label}`}
            placeholder={`${column.label}: none`}
            size="xs"
            w={170}
            clearable
            value={aggregations.find((a) => a.columnId === column.id)?.agg ?? null}
            data={aggs.map((a) => ({ value: a, label: AGG_LABELS[a] }))}
            onChange={(v) => setAgg(column.id, (v as AggregationId | null) ?? null)}
            comboboxProps={{ withinPortal: false }}
          />
        ))}
    </Group>
  );
}
