import { Box, Button, Group, MultiSelect, NumberInput, Select, Stack, TagsInput, Text, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconChevronDown } from "../internal/icons";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { ColumnTypeIcon } from "../filter-builder/columnTypeIcon";
import type {
  FilterCondition,
  FilterOperatorDef,
  FilterPrimitive,
  FilterValue,
  GridRow,
  RelativeDate,
  RelativeDateKind,
} from "../internal/core-contracts";
import { COLUMN_FILTER_CSS } from "./columnFilterStyles";
import {
  INLINE_COMBOBOX,
  INLINE_POPOVER,
  PASS_ALL_FILTER_METHODS,
  RELATIVE_DATE_LABELS,
  type ResolvedFilterColumn,
  type SchemaFilterProps,
  resolveFilterColumn,
  useGridFilter,
} from "./contracts";
import { filterOptions } from "./options";

type ValueType = "number" | "date" | "option" | "text";

interface Draft {
  operator: string;
  single: FilterPrimitive;
  multi: string[];
  from: FilterPrimitive;
  to: FilterPrimitive;
  relative: RelativeDateKind;
  n: number | null;
}

const RELATIVE_KINDS = Object.keys(RELATIVE_DATE_LABELS) as RelativeDateKind[];
const RELATIVE_DATA = RELATIVE_KINDS.map((k) => ({ value: k, label: RELATIVE_DATE_LABELS[k] }));
const NEEDS_N = new Set<RelativeDateKind>(["lastNDays", "nextNDays"]);
const CHEVRON = <IconChevronDown size={12} stroke={1.75} aria-hidden />;
const SELECT_SECTION = { rightSection: CHEVRON, rightSectionPointerEvents: "none" as const };

export function valueTypeOf(resolved: ResolvedFilterColumn): ValueType {
  const id = resolved.fieldType.id;
  if (id === "number" || id === "currency") return "number";
  if (id === "date" || id === "datetime") return "date";
  if (filterOptions(resolved.config).length > 0) return "option";
  return "text";
}

const isRange = (v: FilterValue | undefined): v is { from: FilterPrimitive; to: FilterPrimitive } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "from" in v && "to" in v;
const isRelative = (v: FilterValue | undefined): v is RelativeDate =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "relative" in v;
const primitive = (v: unknown): FilterPrimitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;

function draftFrom(model: FilterCondition | null | undefined, operators: readonly FilterOperatorDef[]): Draft {
  const operator = model && operators.some((o) => o.id === model.operator) ? model.operator : (operators[0]?.id ?? "");
  const v = model?.value;
  return {
    operator,
    single: primitive(v),
    multi: Array.isArray(v) ? v.map((x) => String(x)) : [],
    from: isRange(v) ? primitive(v.from) : null,
    to: isRange(v) ? primitive(v.to) : null,
    relative: isRelative(v) ? v.relative : "today",
    n: isRelative(v) && typeof v.n === "number" ? v.n : null,
  };
}

const filled = (v: FilterPrimitive): boolean =>
  typeof v === "number" ? Number.isFinite(v) : typeof v === "string" ? v.trim() !== "" : typeof v === "boolean";
const clean = (v: FilterPrimitive): FilterPrimitive => (typeof v === "string" ? v.trim() : v);

type Built = { ok: true; condition: FilterCondition } | { ok: false; error: string };

/** Draft → core `FilterCondition`, same semantics as ag-grid's `ConditionFilter`. */
export function buildColumnCondition(columnId: string, op: FilterOperatorDef, draft: Draft): Built {
  const base: FilterCondition = { columnId, operator: op.id };
  switch (op.valueKind) {
    case "none":
      return { ok: true, condition: base };
    case "me":
      return { ok: true, condition: { ...base, value: { me: true } } };
    case "single":
      return filled(draft.single) ? { ok: true, condition: { ...base, value: clean(draft.single) } } : { ok: false, error: "Enter a value" };
    case "multi": {
      const values = draft.multi.map((s) => s.trim()).filter((s) => s !== "");
      return values.length > 0 ? { ok: true, condition: { ...base, value: values } } : { ok: false, error: "Pick at least one value" };
    }
    case "range": {
      if (!filled(draft.from) && !filled(draft.to)) return { ok: false, error: "Enter a from or to value" };
      const from = filled(draft.from) ? clean(draft.from) : null;
      const to = filled(draft.to) ? clean(draft.to) : null;
      return { ok: true, condition: { ...base, value: { from, to } } };
    }
    case "relativeDate": {
      if (NEEDS_N.has(draft.relative)) {
        const n = draft.n;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return { ok: false, error: "Enter a whole number of days" };
        return { ok: true, condition: { ...base, value: { relative: draft.relative, n } } };
      }
      return { ok: true, condition: { ...base, value: { relative: draft.relative } } };
    }
  }
  return { ok: false, error: "Unsupported operator" };
}

const numberOrNull = (v: number | string): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Column label + type glyph at the top of a column filter card. */
export function ColumnFilterHeader({ resolved }: { resolved: ResolvedFilterColumn }) {
  return (
    <Group gap={6} wrap="nowrap" c="dimmed" className="sg-cf-header">
      <ColumnTypeIcon type={resolved.column.type} size={14} />
      <Text size="xs" fw={500} truncate>
        {resolved.column.label}
      </Text>
    </Group>
  );
}

/**
 * Mantine column filter for condition types (text, numbers, dates, …): a
 * compact 256px card with an operator picker, a type-aware value input and a
 * Clear / Apply footer. Enter applies. The model is a core `FilterCondition`
 * (exactly like ag-grid's `ConditionFilter`); every dropdown renders inside
 * the AG Grid popup (`withinPortal: false`).
 */
export function MantineConditionFilter<Row extends GridRow = GridRow>(props: SchemaFilterProps<Row>) {
  const { model, onModelChange } = props;
  useGridFilter(PASS_ALL_FILTER_METHODS);
  const resolved = resolveFilterColumn({
    schemaColumn: props.schemaColumn,
    fieldType: props.fieldType,
    colDef: props.colDef as never,
    column: props.column as never,
  });
  const operators = resolved?.operators ?? [];
  const [draft, setDraft] = useState<Draft>(() => draftFrom(model, operators));
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => filterOptions(resolved?.config), [resolved?.config]);

  const modelKey = JSON.stringify(model ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only when the model changes from outside.
  useEffect(() => {
    setDraft(draftFrom(model, operators));
    setError(null);
  }, [modelKey]);

  if (!resolved) return null;
  const op = operators.find((o) => o.id === draft.operator) ?? operators[0];
  const kind = op?.valueKind ?? "none";
  const type = valueTypeOf(resolved);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };
  const apply = () => {
    if (!op) return;
    const built = buildColumnCondition(resolved.columnId, op, draft);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    onModelChange(built.condition);
  };
  const clear = () => {
    setDraft(draftFrom(null, operators));
    setError(null);
    onModelChange(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.defaultPrevented || e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement;
    if (t.getAttribute("aria-expanded") === "true" || t.tagName === "BUTTON") return;
    e.preventDefault();
    apply();
  };

  const optionData = options.map((o) => ({ value: o.id, label: o.label }));

  const primitiveInput = (label: string, value: FilterPrimitive, set: (v: FilterPrimitive) => void, autoFocus = false): ReactNode => {
    if (type === "number") {
      return (
        <NumberInput
          aria-label={label}
          placeholder={label}
          size="xs"
          hideControls
          data-autofocus={autoFocus || undefined}
          value={typeof value === "number" ? value : ""}
          onChange={(v) => set(numberOrNull(v))}
        />
      );
    }
    if (type === "date") {
      return (
        <DateInput
          aria-label={label}
          placeholder={label === "Value" ? "Pick a date" : label}
          size="xs"
          valueFormat="YYYY-MM-DD"
          clearable
          value={typeof value === "string" && value ? value : null}
          onChange={(v) => set(v ?? null)}
          popoverProps={INLINE_POPOVER}
        />
      );
    }
    if (type === "option") {
      return (
        <Select
          aria-label={label}
          placeholder="Pick a value"
          size="xs"
          searchable
          data={optionData}
          value={typeof value === "string" ? value : null}
          onChange={(v) => set(v)}
          comboboxProps={INLINE_COMBOBOX}
          {...SELECT_SECTION}
        />
      );
    }
    return (
      <TextInput
        aria-label={label}
        placeholder={label}
        size="xs"
        data-autofocus={autoFocus || undefined}
        value={value == null ? "" : String(value)}
        onChange={(e) => set(e.currentTarget.value)}
      />
    );
  };

  let valueInput: ReactNode = null;
  if (kind === "single") valueInput = primitiveInput("Value", draft.single, (v) => update({ single: v }), true);
  else if (kind === "me") {
    valueInput = (
      <Text size="xs" c="dimmed">
        Rows assigned to you
      </Text>
    );
  } else if (kind === "multi") {
    valueInput =
      type === "option" ? (
        <MultiSelect
          aria-label="Values"
          placeholder={draft.multi.length ? undefined : "Pick values"}
          size="xs"
          searchable
          data={optionData}
          value={draft.multi}
          onChange={(v) => update({ multi: v })}
          comboboxProps={INLINE_COMBOBOX}
        />
      ) : (
        <TagsInput
          aria-label="Values"
          placeholder={draft.multi.length ? undefined : "Type and press Enter"}
          size="xs"
          value={draft.multi}
          onChange={(v) => update({ multi: v })}
          comboboxProps={INLINE_COMBOBOX}
        />
      );
  } else if (kind === "range") {
    valueInput = (
      <Group gap={6} wrap="nowrap" grow>
        {primitiveInput("From", draft.from, (v) => update({ from: v }))}
        {primitiveInput("To", draft.to, (v) => update({ to: v }))}
      </Group>
    );
  } else if (kind === "relativeDate") {
    valueInput = (
      <Group gap={6} wrap="nowrap">
        <Select
          aria-label="Relative date"
          size="xs"
          style={{ flex: 1, minWidth: 0 }}
          allowDeselect={false}
          data={RELATIVE_DATA}
          value={draft.relative}
          onChange={(v) => v && update({ relative: v as RelativeDateKind })}
          comboboxProps={INLINE_COMBOBOX}
          {...SELECT_SECTION}
        />
        {NEEDS_N.has(draft.relative) ? (
          <NumberInput
            aria-label="Number of days"
            placeholder="Days"
            size="xs"
            w={72}
            min={1}
            allowDecimal={false}
            hideControls
            value={draft.n ?? ""}
            onChange={(v) => update({ n: numberOrNull(v) })}
          />
        ) : null}
      </Group>
    );
  }

  return (
    // Enter-to-apply is delegated from the inputs inside.
    <Box className="sg-cf sg-cf-condition" onKeyDown={onKeyDown}>
      <style>{COLUMN_FILTER_CSS}</style>
      <Stack gap={8} p={12}>
        <ColumnFilterHeader resolved={resolved} />
        <Select
          aria-label="Operator"
          size="xs"
          allowDeselect={false}
          data={operators.map((o) => ({ value: o.id, label: o.label }))}
          value={op?.id ?? null}
          onChange={(v) => v && update({ operator: v })}
          comboboxProps={INLINE_COMBOBOX}
          {...SELECT_SECTION}
        />
        {valueInput}
        {error ? (
          <Text size="xs" c="red" role="alert">
            {error}
          </Text>
        ) : null}
      </Stack>
      <Box className="sg-cf-footer">
        <Button size="xs" variant="subtle" color="gray" onClick={clear}>
          Clear
        </Button>
        <Button size="xs" onClick={apply}>
          Apply
        </Button>
      </Box>
    </Box>
  );
}
