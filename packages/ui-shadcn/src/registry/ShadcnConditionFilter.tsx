import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { DateEditor } from "../editors/DateEditors";
import { ToneDot } from "../editors/EditorCard";
import type { ColumnDef, FilterCondition, FilterOperatorDef, FilterPrimitive, FilterValue, RelativeDate, RelativeDateKind } from "../internal/core-contracts";
import {
  RELATIVE_DATE_LABELS,
  type ResolvedFilterColumn,
  type SchemaFilterProps,
  resolveFilterColumn,
  useGridFilter,
} from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { FilterShell, PASS_ALL_FILTER_METHODS, choiceAsOption, configChoices } from "./filterShared";

const RELATIVE_KINDS = Object.keys(RELATIVE_DATE_LABELS) as RelativeDateKind[];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isNumericType = (resolved: ResolvedFilterColumn) => resolved.fieldType.id === "number" || resolved.fieldType.id === "currency";
const isDateType = (resolved: ResolvedFilterColumn) => resolved.fieldType.id === "date" || resolved.fieldType.id === "datetime";

type Parsed = { ok: true; value: FilterPrimitive } | { ok: false; error: string };

/** Parses one raw input into the typed primitive the AST stores (number, "YYYY-MM-DD", or trimmed text). */
function parsePrimitive(resolved: ResolvedFilterColumn, raw: string): Parsed {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "Enter a value" };
  const { fieldType, config } = resolved;
  if (isNumericType(resolved)) {
    const r = fieldType.parse(text, config);
    if (!r.ok) return { ok: false, error: r.error };
    return typeof r.value === "number" ? { ok: true, value: r.value } : { ok: false, error: "Not a number" };
  }
  if (isDateType(resolved)) {
    return DATE_RE.test(text) ? { ok: true, value: text } : { ok: false, error: "Pick a date" };
  }
  return { ok: true, value: text };
}

interface Draft {
  operator: string;
  single: string;
  multi: string[];
  multiText: string;
  from: string;
  to: string;
  relative: RelativeDateKind;
  n: string;
}

const isRange = (v: FilterValue | undefined): v is { from: FilterPrimitive; to: FilterPrimitive } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "from" in v && "to" in v;
const isRelative = (v: FilterValue | undefined): v is RelativeDate => typeof v === "object" && v !== null && !Array.isArray(v) && "relative" in v;
const str = (v: FilterPrimitive | undefined): string => (v === null || v === undefined ? "" : String(v));

function draftFrom(model: FilterCondition | null, operators: readonly FilterOperatorDef[]): Draft {
  const operator = model && operators.some((o) => o.id === model.operator) ? model.operator : (operators[0]?.id ?? "");
  const v = model?.value;
  const primitive = typeof v === "object" && v !== null ? undefined : v;
  const list = Array.isArray(v) ? v.map((x) => str(x)) : [];
  return {
    operator,
    single: str(primitive),
    multi: list,
    multiText: list.join(", "),
    from: isRange(v) ? str(v.from) : "",
    to: isRange(v) ? str(v.to) : "",
    relative: isRelative(v) ? v.relative : "today",
    n: isRelative(v) && v.n !== undefined ? String(v.n) : "",
  };
}

type Built = { ok: true; condition: FilterCondition } | { ok: false; error: string };

/** Same model as ag-grid's `ConditionFilter`: a core `FilterCondition` keyed by the AG Grid column id. */
function buildCondition(resolved: ResolvedFilterColumn, draft: Draft, opDef: FilterOperatorDef, useChoices: boolean): Built {
  const base = { columnId: resolved.columnId, operator: opDef.id };
  switch (opDef.valueKind) {
    case "none":
      return { ok: true, condition: base };
    case "me":
      return { ok: true, condition: { ...base, value: { me: true } } };
    case "single": {
      const p = parsePrimitive(resolved, draft.single);
      return p.ok ? { ok: true, condition: { ...base, value: p.value } } : p;
    }
    case "multi": {
      const raw = useChoices ? draft.multi : draft.multiText.split(",");
      const values: FilterPrimitive[] = [];
      for (const item of raw) {
        if (item.trim() === "") continue;
        const p = parsePrimitive(resolved, item);
        if (!p.ok) return p;
        values.push(p.value);
      }
      return values.length > 0 ? { ok: true, condition: { ...base, value: values } } : { ok: false, error: "Pick at least one value" };
    }
    case "range": {
      const from = draft.from.trim() === "" ? null : parsePrimitive(resolved, draft.from);
      const to = draft.to.trim() === "" ? null : parsePrimitive(resolved, draft.to);
      if (!from && !to) return { ok: false, error: "Enter a from or to value" };
      if (from && !from.ok) return from;
      if (to && !to.ok) return to;
      return { ok: true, condition: { ...base, value: { from: from ? from.value : null, to: to ? to.value : null } } };
    }
    case "relativeDate": {
      if (draft.relative === "lastNDays" || draft.relative === "nextNDays") {
        const n = Number(draft.n);
        if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Enter a whole number of days" };
        return { ok: true, condition: { ...base, value: { relative: draft.relative, n } } };
      }
      return { ok: true, condition: { ...base, value: { relative: draft.relative } } };
    }
  }
  return { ok: false, error: "Unsupported operator" };
}

const relabel = (column: ColumnDef, label: string): ColumnDef => ({ ...column, label });

/**
 * Radix column filter for AG Grid: operator picker + a value input shaped by
 * the operator's `valueKind` and the column type (right-aligned numbers, a
 * calendar picker for dates, tone-dotted option picker / checkbox list for
 * select-likes, relative-date presets for "is within"). Apply / Enter emits
 * the same core `FilterCondition` as ag-grid's `ConditionFilter`; Clear emits
 * null. `doesFilterPass` always passes — rows arrive pre-filtered by core.
 * Radix lists / popovers are portalled with AG Grid's
 * `ag-custom-component-popup` marker, so clicks in them never close the filter.
 */
export function ShadcnConditionFilter(props: SchemaFilterProps) {
  const { model, onModelChange } = props;
  useGridFilter(PASS_ALL_FILTER_METHODS);
  const id = useId();

  const resolved = resolveFilterColumn({
    schemaColumn: props.schemaColumn,
    fieldType: props.fieldType,
    colDef: props.colDef as never,
    column: props.column as never,
  });
  const operators = resolved?.operators ?? [];
  const [draft, setDraft] = useState<Draft>(() => draftFrom(model, operators));
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the model changes from outside (e.g. the compound builder or a view).
  const modelKey = JSON.stringify(model ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised model on purpose.
  useEffect(() => {
    setDraft(draftFrom(model, operators));
    setError(null);
  }, [modelKey]);

  const choices = useMemo(() => configChoices(resolved?.config), [resolved?.config]);
  if (!resolved) return null;

  const opDef = operators.find((o) => o.id === draft.operator) ?? operators[0];
  const useChoices = choices.length > 0;
  const kind = opDef?.valueKind ?? "none";
  const numeric = isNumericType(resolved);
  const date = isDateType(resolved);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };
  const apply = () => {
    if (!opDef) return;
    const built = buildCondition(resolved, draft, opDef, useChoices);
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
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter in a text field applies; buttons / pickers keep their own Enter.
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && !event.defaultPrevented) {
      event.preventDefault();
      apply();
    }
  };

  const textInput = (label: string, value: string, onChange: (v: string) => void, extra?: { placeholder?: string; className?: string }) => (
    <Input
      aria-label={label}
      type="text"
      inputMode={numeric ? "decimal" : undefined}
      value={value}
      placeholder={extra?.placeholder ?? (numeric ? "0" : "Value")}
      aria-invalid={error ? true : undefined}
      className={cn(numeric && "sg:text-right", extra?.className)}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  const dateInput = (label: string, value: string, onChange: (v: string) => void) => (
    <DateEditor
      value={value || null}
      onChange={(v) => onChange(v ?? "")}
      onCommit={(v) => {
        if (v !== undefined) onChange(v ?? "");
      }}
      onCancel={() => {}}
      column={relabel(resolved.column, label)}
      config={resolved.config}
      autoFocus={false}
    />
  );

  const valueInput = (() => {
    switch (kind) {
      case "single":
        if (useChoices) {
          return (
            <Select value={draft.single || undefined} onValueChange={(v) => update({ single: v })}>
              <SelectTrigger aria-label="Value">
                <SelectValue placeholder="Select a value" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <ToneDot option={choiceAsOption(c)} />
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }
        return date ? dateInput("Value", draft.single, (v) => update({ single: v })) : textInput("Value", draft.single, (v) => update({ single: v }));
      case "multi":
        if (useChoices) {
          return (
            <fieldset className="sg:m-0 sg:flex sg:max-h-56 sg:flex-col sg:overflow-y-auto sg:border-0 sg:p-0">
              <legend className="sg:sr-only">Values</legend>
              {choices.map((c) => {
                const boxId = `${id}-${c.id}`;
                const checked = draft.multi.includes(c.id);
                return (
                  <label
                    key={c.id}
                    htmlFor={boxId}
                    className="sg:flex sg:h-[30px] sg:shrink-0 sg:cursor-default sg:items-center sg:gap-2 sg:rounded-md sg:px-1.5 sg:text-sm sg:hover:bg-muted"
                  >
                    <Checkbox
                      id={boxId}
                      checked={checked}
                      onCheckedChange={(next) =>
                        update({ multi: next === true ? [...draft.multi.filter((v) => v !== c.id), c.id] : draft.multi.filter((v) => v !== c.id) })
                      }
                    />
                    <ToneDot option={choiceAsOption(c)} />
                    <span className="sg:truncate">{c.label}</span>
                  </label>
                );
              })}
            </fieldset>
          );
        }
        return textInput("Value", draft.multiText, (v) => update({ multiText: v }), { placeholder: "Comma-separated values" });
      case "range":
        return (
          <div className="sg:grid sg:grid-cols-[1fr_auto_1fr] sg:items-start sg:gap-1.5">
            {date ? dateInput("From", draft.from, (v) => update({ from: v })) : textInput("From", draft.from, (v) => update({ from: v }), { placeholder: "From" })}
            <span aria-hidden className="sg:flex sg:h-8 sg:items-center sg:text-xs sg:text-faint-foreground">
              –
            </span>
            {date ? dateInput("To", draft.to, (v) => update({ to: v })) : textInput("To", draft.to, (v) => update({ to: v }), { placeholder: "To" })}
          </div>
        );
      case "relativeDate": {
        const needsN = draft.relative === "lastNDays" || draft.relative === "nextNDays";
        return (
          <div className="sg:flex sg:items-center sg:gap-1.5">
            <Select value={draft.relative} onValueChange={(v) => update({ relative: v as RelativeDateKind })}>
              <SelectTrigger aria-label="Relative date" className="sg:flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIVE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {RELATIVE_DATE_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsN ? (
              <div className="sg:relative sg:w-24 sg:shrink-0">
                <Input
                  aria-label="Number of days"
                  type="text"
                  inputMode="numeric"
                  value={draft.n}
                  placeholder="7"
                  aria-invalid={error ? true : undefined}
                  className="sg:pr-10 sg:text-right"
                  onChange={(e) => update({ n: e.target.value.replace(/[^\d]/g, "") })}
                />
                <span className="sg:pointer-events-none sg:absolute sg:top-1/2 sg:right-2.5 sg:-translate-y-1/2 sg:text-xs sg:text-faint-foreground">days</span>
              </div>
            ) : null}
          </div>
        );
      }
      default:
        return null;
    }
  })();

  return (
    <FilterShell
      footer={
        <>
          <Button variant="ghost" size="xs" onClick={clear}>
            Clear
          </Button>
          <Button variant="primary" size="xs" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <div className="sg-condition-filter sg:flex sg:flex-col sg:gap-2 sg:p-2" onKeyDown={onKeyDown}>
        <Select value={opDef?.id ?? ""} onValueChange={(v) => update({ operator: v })}>
          <SelectTrigger aria-label="Operator" size="sm" className="sg:font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {valueInput}
        {error ? (
          <p role="alert" className="sg:text-xs sg:text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </FilterShell>
  );
}
