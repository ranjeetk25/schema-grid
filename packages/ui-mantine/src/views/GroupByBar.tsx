import {
  ActionIcon,
  Badge,
  Box,
  Button,
  CloseButton,
  Group,
  Popover,
  Select,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconChevronDown, IconChevronRight, IconLayoutList, IconX } from "../internal/icons";
import { useState } from "react";
import { ColumnTypeIcon } from "../filter-builder/columnTypeIcon";
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

export interface GroupByBarProps {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: AccessMap;
  value: GroupSpec[];
  onChange(next: GroupSpec[]): void;
  maxGroups?: number;
  /** Button label (also its accessible name). Default "Group". */
  label?: string;
  /** Hide the "Grouped by A › B" summary pill next to the button. Default false. */
  hideSummary?: boolean;
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

const NUMERIC_VALUE_TYPES = new Set(["number", "currency"]);

const ICON = { size: 14, stroke: 1.75 } as const;
const COMBOBOX = { withinPortal: false, offset: 4 } as const;
/** Rule 9: unavailable ghost actions are 40% opacity, no fill. */
const DISABLED = { background: "transparent", opacity: 0.4 } as const;
const CHEVRON = <IconChevronDown size={12} stroke={1.75} aria-hidden />;

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
 * Toolbar grouping control: ONE "Group" button (count badge) that opens a
 * compact popover — the grouping columns as removable, reorderable rows, an
 * "Add group" picker, and a collapsed "Summaries" section with a per-column
 * aggregation select (aggregations attach to the first group, as before).
 * Next to the button a quiet pill reads "Grouped by A › B" with a clear ×.
 */
export function GroupByBar({
  schema,
  registry,
  access,
  value,
  onChange,
  maxGroups = 3,
  label = "Group",
  hideSummary = false,
}: GroupByBarProps) {
  const [opened, setOpened] = useState(false);
  const [summariesOpen, setSummariesOpen] = useState(false);
  const readable = readableColumns(schema, access);
  const byId = new Map(readable.map((c) => [c.id, c]));
  const used = new Set(value.map((g) => g.columnId));
  const addable = readable.filter((c) => !used.has(c.id) && !NON_GROUPABLE.has(c.type));
  const numeric = readable
    .map((c) => ({ column: c, aggs: aggregationsFor(c, registry) }))
    .filter((x) => x.aggs.length > 0);
  const aggregations = value[0]?.aggregations ?? [];
  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  const typeOf = new Map(readable.map((c) => [c.id, c.type]));

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

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    onChange(withAggregations(next, aggregations));
  };

  const setAgg = (columnId: string, agg: AggregationId | null) => {
    const others = aggregations.filter((a) => a.columnId !== columnId);
    onChange(withAggregations(value, agg ? [...others, { columnId, agg }] : others));
  };

  const full = value.length >= maxGroups;
  const summary = value.map((g) => labelOf(g.columnId)).join(" › ");

  return (
    <Group gap={6} wrap="nowrap" align="center">
      <Popover opened={opened} onChange={setOpened} withinPortal={false} position="bottom-start" offset={6} trapFocus={false}>
        <Popover.Target>
          <Button
            variant="subtle"
            color="gray"
            aria-label={label}
            onClick={() => setOpened((o) => !o)}
            leftSection={<IconLayoutList size={16} stroke={1.75} aria-hidden />}
            rightSection={
              value.length > 0 ? (
                <Badge size="sm" circle variant="light" aria-hidden data-testid="group-count">
                  {value.length}
                </Badge>
              ) : undefined
            }
            styles={{ root: { paddingInline: 10 }, section: { marginInlineEnd: 6 } }}
          >
            {label}
          </Button>
        </Popover.Target>
        <Popover.Dropdown w={320} p={12}>
          <Stack gap={8}>
            <Text size="xs" c="dimmed" fw={500}>
              Group rows by
            </Text>

            {value.length === 0 ? (
              <Text size="sm" c="dimmed">
                No grouping
              </Text>
            ) : (
              <Stack component="ul" gap={2} aria-label="Grouping columns" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {value.map((g, i) => {
                  const name = labelOf(g.columnId);
                  return (
                    <Group
                      component="li"
                      key={g.columnId}
                      gap={8}
                      wrap="nowrap"
                      h={30}
                      px={4}
                    >
                      <Text size="xs" c="dimmed" w={12} ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {i + 1}
                      </Text>
                      <Box c="dimmed" style={{ display: "inline-flex" }}>
                        <ColumnTypeIcon type={typeOf.get(g.columnId)} />
                      </Box>
                      <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                        {name}
                      </Text>
                      <Group gap={0} wrap="nowrap">
                        <ActionIcon
                          size="sm"
                          aria-label={`Move ${name} up`}
                          disabled={i === 0}
                          style={i === 0 ? DISABLED : undefined}
                          onClick={() => move(i, -1)}
                        >
                          <IconArrowUp {...ICON} />
                        </ActionIcon>
                        <ActionIcon
                          size="sm"
                          aria-label={`Move ${name} down`}
                          disabled={i === value.length - 1}
                          style={i === value.length - 1 ? DISABLED : undefined}
                          onClick={() => move(i, 1)}
                        >
                          <IconArrowDown {...ICON} />
                        </ActionIcon>
                        <ActionIcon size="sm" aria-label={`Remove group ${name}`} onClick={() => remove(g.columnId)}>
                          <IconX {...ICON} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            )}

            <Select
              aria-label="Add group"
              placeholder={full ? `Up to ${maxGroups} levels` : "Add group…"}
              size="xs"
              value={null}
              data={addable.map((c) => ({ value: c.id, label: c.label }))}
              onChange={add}
              disabled={full || addable.length === 0}
              searchable
              rightSection={CHEVRON}
              rightSectionPointerEvents="none"
              renderOption={({ option }) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-flex", color: "var(--mantine-color-dimmed)" }}>
                    <ColumnTypeIcon type={typeOf.get(option.value)} />
                  </span>
                  {option.label}
                </span>
              )}
              comboboxProps={COMBOBOX}
            />

            {value.length > 0 && numeric.length > 0 ? (
              <Box style={{ borderTop: "1px solid var(--mantine-color-default-border)", margin: "0 -12px", padding: "6px 12px 0" }}>
                <UnstyledButton
                  aria-expanded={summariesOpen}
                  onClick={() => setSummariesOpen((o) => !o)}
                  style={{ display: "flex", alignItems: "center", gap: 6, height: 28, width: "100%", fontSize: 13 }}
                >
                  <Box c="dimmed" style={{ display: "inline-flex" }}>
                    {summariesOpen ? <IconChevronDown {...ICON} /> : <IconChevronRight {...ICON} />}
                  </Box>
                  <Text span size="sm" fw={500}>
                    Summaries
                  </Text>
                  {aggregations.length > 0 ? (
                    <Text span size="sm" c="dimmed">{`· ${aggregations.length}`}</Text>
                  ) : null}
                </UnstyledButton>
                {summariesOpen ? (
                  <Stack gap={4} pt={4} pb={2}>
                    {numeric.map(({ column, aggs }) => (
                      <Group key={column.id} gap={8} wrap="nowrap" justify="space-between">
                        <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                          {column.label}
                        </Text>
                        <Select
                          aria-label={`Aggregate ${column.label}`}
                          placeholder="None"
                          size="xs"
                          w={130}
                          clearable
                          value={aggregations.find((a) => a.columnId === column.id)?.agg ?? null}
                          data={aggs.map((a) => ({ value: a, label: AGG_LABELS[a] }))}
                          onChange={(v) => setAgg(column.id, (v as AggregationId | null) ?? null)}
                          comboboxProps={COMBOBOX}
                        />
                      </Group>
                    ))}
                  </Stack>
                ) : null}
              </Box>
            ) : null}
          </Stack>
        </Popover.Dropdown>
      </Popover>

      {!hideSummary && value.length > 0 ? (
        <Box
          data-sg-group-summary=""
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 24,
            maxWidth: 360,
            paddingInline: "8px 4px",
            borderRadius: 6,
            background: "var(--mantine-color-default-hover)",
            whiteSpace: "nowrap",
          }}
        >
          <Text component="span" size="xs" truncate title={`Grouped by ${summary}`}>
            <Text component="span" inherit c="dimmed">
              Grouped by{" "}
            </Text>
            <Text component="span" inherit fw={500}>
              {summary}
            </Text>
          </Text>
          <Tooltip label="Clear grouping" withinPortal={false}>
            <CloseButton
              size={18}
              radius={4}
              aria-label="Clear grouping"
              onClick={() => onChange([])}
              icon={<IconX size={12} stroke={2} aria-hidden />}
              style={{ color: "var(--mantine-color-dimmed)", flex: "none" }}
            />
          </Tooltip>
        </Box>
      ) : null}
    </Group>
  );
}
