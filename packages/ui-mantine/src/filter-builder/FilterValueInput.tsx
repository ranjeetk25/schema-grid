import { Group, MultiSelect, NumberInput, Select, Stack, TagsInput, Text, TextInput } from "@mantine/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type ColumnDef,
  type DataSource,
  type FieldTypeId,
  type FilterOperatorDef,
  type FilterPrimitive,
  type FilterValue,
  type GridSchema,
  RELATIVE_DATE_PRESETS,
  type RelativeDate,
  type RelativeDatePreset,
  inferResultType,
  isFormulaError,
  parseFormula,
} from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { getSelectOptions } from "../internal/options";

export interface FilterValueInputProps {
  column: ColumnDef;
  operator: FilterOperatorDef;
  value: FilterValue | null | undefined;
  onChange(value: FilterValue | null | undefined): void;
  /** UI registry; its `filterComponent`s render `single` values for non-option types. */
  registry: UiFieldTypeRegistry;
  dataSource?: DataSource;
  /** Needed to resolve a formula column's result type. */
  schema?: GridSchema;
  error?: string;
}

export const RELATIVE_DATE_LABELS: Record<RelativeDatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  tomorrow: "Tomorrow",
  thisWeek: "This week",
  lastWeek: "Last week",
  thisMonth: "This month",
  lastMonth: "Last month",
  lastNDays: "Last N days",
  nextNDays: "Next N days",
};

const RELATIVE_DATA = RELATIVE_DATE_PRESETS.map((p) => ({ value: p, label: RELATIVE_DATE_LABELS[p] }));
const N_PRESETS: readonly RelativeDatePreset[] = ["lastNDays", "nextNDays"];

const OPTION_TYPES = new Set<FieldTypeId>(["select", "creatableSelect", "multiSelect"]);
const NUMERIC_TYPES = new Set<FieldTypeId>(["number", "currency"]);
const DATE_TYPES = new Set<FieldTypeId>(["date", "datetime"]);

const COMBOBOX = { withinPortal: false } as const;

/** The type a filter value is typed as: formula columns resolve to their result type. */
export function effectiveFilterType(column: ColumnDef, schema?: GridSchema): FieldTypeId {
  if (column.type !== "formula") return column.type;
  if (!schema || !column.formula) return "text";
  const ast = parseFormula(column.formula);
  return isFormulaError(ast) ? "text" : inferResultType(ast, schema);
}

const numberOrNull = (v: number | string): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const asPrimitive = (v: unknown): FilterPrimitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;

const asRange = (v: unknown): { from: FilterPrimitive; to: FilterPrimitive } =>
  v && typeof v === "object" && "from" in v && "to" in v
    ? { from: asPrimitive((v as { from: unknown }).from), to: asPrimitive((v as { to: unknown }).to) }
    : { from: null, to: null };

const asRelative = (v: unknown): RelativeDate | null =>
  v && typeof v === "object" && "relative" in v ? (v as RelativeDate) : null;

const isMeValue = (v: unknown) => !!v && typeof v === "object" && (v as { me?: unknown }).me === true;

function ErrorText({ error }: { error?: string }) {
  return error ? (
    <Text c="red" size="xs">
      {error}
    </Text>
  ) : null;
}

function MeInput({ value, onChange }: { value: unknown; onChange: (v: FilterValue) => void }) {
  const emitted = useRef(false);
  const already = isMeValue(value);
  useEffect(() => {
    if (!already && !emitted.current) {
      emitted.current = true;
      onChange({ me: true });
    }
  }, [already, onChange]);
  return (
    <Text size="sm" c="dimmed">
      Current user
    </Text>
  );
}

function useUserOptions(enabled: boolean, column: ColumnDef, dataSource?: DataSource) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!enabled || !dataSource?.getOptions) return;
    let alive = true;
    dataSource.getOptions(column.id).then(
      (opts) => {
        if (alive) setOptions(opts.map((o) => ({ value: o.value, label: o.label })));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [enabled, column.id, dataSource]);
  return options;
}

/**
 * The value editor of one filter condition, chosen by `operator.valueKind`.
 * Every dropdown renders inline (`withinPortal: false`) because the builder
 * usually lives inside a Popover.
 */
export function FilterValueInput(props: FilterValueInputProps) {
  const { column, operator, value, onChange, registry, dataSource, schema, error } = props;
  const type = effectiveFilterType(column, schema);
  const isOptionType = OPTION_TYPES.has(type);
  const userOptions = useUserOptions(operator.valueKind === "multi" && type === "user", column, dataSource);

  const registryInput = (v: FilterValue | null | undefined, emit: (v: FilterValue | null) => void): ReactNode => {
    const Filter = registry.get(type)?.filterComponent ?? registry.get(column.type)?.filterComponent;
    return Filter ? <Filter column={column} operator={operator} value={v} onChange={emit} dataSource={dataSource} /> : null;
  };

  switch (operator.valueKind) {
    case "none":
      return null;

    case "me":
      return <MeInput value={value} onChange={onChange} />;

    case "single": {
      if (type === "select" || type === "creatableSelect") {
        const data = getSelectOptions(column.config).map((o) => ({ value: o.value, label: o.label }));
        return (
          <Select
            aria-label="Value"
            placeholder="Value"
            searchable
            data={data}
            value={typeof value === "string" ? value : null}
            onChange={(v) => onChange(v)}
            error={error}
            comboboxProps={COMBOBOX}
          />
        );
      }
      const custom = registryInput(value, onChange);
      if (custom) {
        return (
          <Stack gap={2}>
            {custom}
            <ErrorText error={error} />
          </Stack>
        );
      }
      if (NUMERIC_TYPES.has(type)) {
        return (
          <NumberInput
            aria-label="Value"
            placeholder="Value"
            value={typeof value === "number" ? value : ""}
            onChange={(v) => onChange(numberOrNull(v))}
            error={error}
          />
        );
      }
      return (
        <TextInput
          aria-label="Value"
          placeholder={DATE_TYPES.has(type) ? "YYYY-MM-DD" : "Value"}
          value={value == null ? "" : String(asPrimitive(value) ?? "")}
          onChange={(e) => onChange(e.currentTarget.value)}
          error={error}
        />
      );
    }

    case "multi": {
      const current = Array.isArray(value) ? value.map((v) => String(v)) : [];
      if (isOptionType || type === "user") {
        const data =
          type === "user" ? userOptions : getSelectOptions(column.config).map((o) => ({ value: o.value, label: o.label }));
        return (
          <MultiSelect
            aria-label="Values"
            placeholder="Values"
            searchable
            data={data}
            value={current}
            onChange={(v) => onChange(v)}
            error={error}
            comboboxProps={COMBOBOX}
          />
        );
      }
      return (
        <TagsInput
          aria-label="Values"
          placeholder="Type and press Enter"
          value={current}
          onChange={(v) => onChange(v)}
          error={error}
          comboboxProps={COMBOBOX}
        />
      );
    }

    case "range": {
      const range = asRange(value);
      const emit = (part: "from" | "to", v: FilterPrimitive) =>
        onChange(part === "from" ? { from: v, to: range.to } : { from: range.from, to: v });
      const side = (part: "from" | "to", label: string): ReactNode => {
        const v = range[part];
        if (NUMERIC_TYPES.has(type)) {
          return (
            <NumberInput
              label={label}
              size="xs"
              value={typeof v === "number" ? v : ""}
              onChange={(n) => emit(part, numberOrNull(n))}
            />
          );
        }
        if (DATE_TYPES.has(type)) {
          const custom = registryInput(v, (next) => emit(part, asPrimitive(next)));
          if (custom) {
            return (
              <Stack gap={2}>
                <Text size="xs" fw={500}>
                  {label}
                </Text>
                {custom}
              </Stack>
            );
          }
        }
        return (
          <TextInput
            label={label}
            size="xs"
            placeholder={DATE_TYPES.has(type) ? "YYYY-MM-DD" : undefined}
            value={v == null ? "" : String(v)}
            onChange={(e) => emit(part, e.currentTarget.value === "" ? null : e.currentTarget.value)}
          />
        );
      };
      return (
        <Stack gap={2}>
          <Group gap="xs" wrap="nowrap" align="flex-end">
            {side("from", "From")}
            {side("to", "To")}
          </Group>
          <ErrorText error={error} />
        </Stack>
      );
    }

    case "relativeDate": {
      const rd = asRelative(value);
      const preset = rd?.relative ?? null;
      const needsN = preset !== null && N_PRESETS.includes(preset);
      return (
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Select
            aria-label="Relative date"
            data={RELATIVE_DATA}
            value={preset}
            allowDeselect={false}
            onChange={(p) => {
              if (!p) return;
              const nextPreset = p as RelativeDatePreset;
              const keepN = N_PRESETS.includes(nextPreset) && typeof rd?.n === "number";
              onChange(keepN ? { relative: nextPreset, n: rd?.n as number } : { relative: nextPreset });
            }}
            error={error}
            comboboxProps={COMBOBOX}
          />
          {needsN && preset ? (
            <NumberInput
              aria-label="N"
              placeholder="N"
              min={1}
              allowDecimal={false}
              w={80}
              value={typeof rd?.n === "number" ? rd.n : ""}
              onChange={(n) => {
                const num = numberOrNull(n);
                onChange(num === null ? { relative: preset } : { relative: preset, n: num });
              }}
            />
          ) : null}
        </Group>
      );
    }
  }
}
