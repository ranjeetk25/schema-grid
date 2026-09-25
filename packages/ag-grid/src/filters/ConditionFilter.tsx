import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { ColDef, Column } from "ag-grid-community";
import { type CustomFilterProps, useGridFilter } from "ag-grid-react";
import {
  type ColumnDef,
  createDefaultRegistry,
  effectiveFieldType,
  type FieldType,
  type FilterCondition,
  type FilterOperatorDef,
  type FilterPrimitive,
  type FilterValue,
  type GridRow,
  type Option,
  operatorsFor,
  type RelativeDate,
  type RelativeDateKind,
} from "../internal/core";

/** Props our filter components accept: AG Grid's, plus the optional `filterParams` spread (`schemaColumn`/`fieldType`). */
export type SchemaFilterProps<Row extends GridRow = GridRow> = CustomFilterProps<Row, unknown, FilterCondition> & {
  schemaColumn?: ColumnDef;
  fieldType?: FieldType<unknown, unknown>;
};

export interface ResolvedFilterColumn {
  columnId: string;
  column: ColumnDef;
  /** The field type that governs filter semantics (formula → its result type). */
  fieldType: FieldType<unknown, unknown>;
  /** `column.config`, or the effective type's default config for formulas / missing config. */
  config: unknown;
  operators: readonly FilterOperatorDef[];
}

interface SchemaParamsLike {
  schemaColumn?: unknown;
  fieldType?: unknown;
}

const defaultRegistry = createDefaultRegistry();

function isColumnDef(x: unknown): x is ColumnDef {
  return typeof x === "object" && x !== null && "id" in x && "type" in x && "label" in x;
}

function isFieldType(x: unknown): x is FieldType<unknown, unknown> {
  return typeof x === "object" && x !== null && "operators" in x && "parse" in x;
}

/**
 * Stable across renders: ag-grid-react treats a new `doesFilterPass` identity on a
 * re-render of an active filter as "the filter logic changed" and fires a spurious
 * `filterChanged`, which resets the infinite row model (a duplicate server fetch).
 */
const PASS_ALL_FILTER_METHODS = { doesFilterPass: () => true };

/**
 * Finds the schema column behind a filter / floating filter. Looks, in order,
 * at props spread from `colDef.filterParams`, `colDef.filterParams`, then
 * `colDef.cellRendererParams` (which `compileColumns` always sets).
 */
export function resolveFilterColumn(input: {
  schemaColumn?: unknown;
  fieldType?: unknown;
  colDef?: ColDef<never> | ColDef<GridRow> | null;
  column?: Pick<Column, "getColDef" | "getColId"> | Partial<Pick<Column, "getColDef" | "getColId">> | null;
}): ResolvedFilterColumn | undefined {
  const colDef = (input.colDef ?? input.column?.getColDef?.() ?? undefined) as ColDef<GridRow> | undefined;
  const fromFilterParams = colDef?.filterParams as SchemaParamsLike | undefined;
  const fromRenderer = colDef?.cellRendererParams as SchemaParamsLike | undefined;
  const candidates: SchemaParamsLike[] = [
    { schemaColumn: input.schemaColumn, fieldType: input.fieldType },
    fromFilterParams ?? {},
    fromRenderer ?? {},
  ];
  const source = candidates.find((c) => isColumnDef(c.schemaColumn));
  if (!source || !isColumnDef(source.schemaColumn)) return undefined;
  const column = source.schemaColumn;
  const supplied = isFieldType(source.fieldType) ? source.fieldType : undefined;
  const fieldType =
    column.type === "formula" || !supplied ? effectiveFieldType(defaultRegistry, column) ?? supplied : supplied;
  if (!fieldType) return undefined;
  const config = column.type === "formula" ? fieldType.defaultConfig : (column.config ?? fieldType.defaultConfig);
  const columnId = colDef?.colId ?? input.column?.getColId?.() ?? column.id;
  return { columnId, column, fieldType, config, operators: operatorsFor(fieldType, column) };
}

/** A select-like option normalised for filter UIs: `id` is the stored value. */
export interface FilterOption {
  id: string;
  label: string;
}

/**
 * Normalises an option to `{ id, label }`. Core's `Option` keys the stored
 * value as `id`; older shapes used `value` — both are accepted.
 */
export function toFilterOption(o: Option | { id?: unknown; value?: unknown; label?: unknown }): FilterOption | undefined {
  const raw = o as { id?: unknown; value?: unknown; label?: unknown };
  const id = raw.id ?? raw.value;
  if (id === undefined || id === null) return undefined;
  return { id: String(id), label: raw.label === undefined || raw.label === null ? String(id) : String(raw.label) };
}

export function toFilterOptions(list: readonly unknown[]): FilterOption[] {
  const out: FilterOption[] = [];
  for (const o of list) {
    if (typeof o !== "object" || o === null) continue;
    const opt = toFilterOption(o as { id?: unknown });
    if (opt) out.push(opt);
  }
  return out;
}

/** Static options from a select-like column config (empty when there are none). */
export function configOptions(config: unknown): FilterOption[] {
  const options = (config as { options?: unknown } | null | undefined)?.options;
  return Array.isArray(options) ? toFilterOptions(options) : [];
}

export const RELATIVE_DATE_LABELS: Record<RelativeDateKind, string> = {
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

const RELATIVE_KINDS = Object.keys(RELATIVE_DATE_LABELS) as RelativeDateKind[];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNumericType(ft: FieldType<unknown, unknown>): boolean {
  return ft.id === "number" || ft.id === "currency";
}

function isDateType(ft: FieldType<unknown, unknown>): boolean {
  return ft.id === "date" || ft.id === "datetime";
}

type Parsed = { ok: true; value: FilterPrimitive } | { ok: false; error: string };

/** Parses one raw input into the typed primitive the AST stores (number, "YYYY-MM-DD", or trimmed text). */
function parsePrimitive(resolved: ResolvedFilterColumn, raw: string): Parsed {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "Enter a value" };
  const { fieldType, config } = resolved;
  if (isNumericType(fieldType)) {
    const r = fieldType.parse(text, config);
    if (!r.ok) return { ok: false, error: r.error };
    return typeof r.value === "number" ? { ok: true, value: r.value } : { ok: false, error: "Not a number" };
  }
  if (isDateType(fieldType)) {
    return DATE_RE.test(text) ? { ok: true, value: text } : { ok: false, error: "Not a date (YYYY-MM-DD)" };
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

function isRange(v: FilterValue | undefined): v is { from: FilterPrimitive; to: FilterPrimitive } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "from" in v && "to" in v;
}

function isRelative(v: FilterValue | undefined): v is RelativeDate {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "relative" in v;
}

function str(v: FilterPrimitive | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

function draftFrom(model: FilterCondition | null, operators: readonly FilterOperatorDef[]): Draft {
  const operator =
    model && operators.some((o) => o.id === model.operator) ? model.operator : (operators[0]?.id ?? "");
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

function buildCondition(resolved: ResolvedFilterColumn, draft: Draft, opDef: FilterOperatorDef, useCheckboxes: boolean): Built {
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
      const raw = useCheckboxes ? draft.multi : draft.multiText.split(",");
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

function inputTypeFor(ft: FieldType<unknown, unknown>): "text" | "number" | "date" {
  if (isDateType(ft)) return "date";
  // Numbers use a text input so formatted input ("1,234.5") still reaches fieldType.parse.
  return "text";
}

/** Our class first: AG Grid's `input[class^=ag-]` rules then don't out-rank the `sg-input` chrome. */
export const INPUT_CLASS = "sg-input ag-input-field-input ag-text-field-input";
export const SELECT_CLASS = "sg-select ag-select";
export const BUTTON_CLASS = "sg-button ag-standard-button";
const SR_ONLY = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
const FIELDSET_RESET = { border: 0, margin: 0, padding: 0, minWidth: 0 } as const;

/**
 * Condition filter: operator `<select>` + a value input shaped by the
 * operator's `valueKind`. Apply/Enter emits a core `FilterCondition`; Clear
 * emits null. `doesFilterPass` always passes — rows arrive pre-filtered by core.
 */
export function ConditionFilter<Row extends GridRow = GridRow>(props: SchemaFilterProps<Row>) {
  const { model, onModelChange } = props;
  useGridFilter(PASS_ALL_FILTER_METHODS);

  const resolved = resolveFilterColumn({
    schemaColumn: props.schemaColumn,
    fieldType: props.fieldType,
    colDef: props.colDef as ColDef<GridRow> | undefined,
    column: props.column as Column | undefined,
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

  const options = useMemo(() => configOptions(resolved?.config), [resolved?.config]);
  if (!resolved) return null;

  const opDef = operators.find((o) => o.id === draft.operator) ?? operators[0];
  const useCheckboxes = options.length > 0;
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const apply = () => {
    if (!opDef) return;
    const built = buildCondition(resolved, draft, opDef, useCheckboxes);
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
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    }
  };

  const inputType = inputTypeFor(resolved.fieldType);
  const kind = opDef?.valueKind ?? "none";

  return (
    <div className="sg-filter sg-condition-filter" onKeyDown={onKeyDown}>
      <div className="sg-filter-body ag-filter-body-wrapper">
      <select className={SELECT_CLASS} aria-label="Operator" value={opDef?.id ?? ""} onChange={(e) => update({ operator: e.target.value })}>
        {operators.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>

      {kind === "single" &&
        (useCheckboxes ? (
          <select className={SELECT_CLASS} aria-label="Value" value={draft.single} onChange={(e) => update({ single: e.target.value })}>
            <option value="" />
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={INPUT_CLASS}
            aria-label="Value"
            placeholder="Value"
            type={inputType}
            value={draft.single}
            onChange={(e) => update({ single: e.target.value })}
          />
        ))}

      {kind === "multi" &&
        (useCheckboxes ? (
          <fieldset className="sg-filter-options" style={FIELDSET_RESET}>
            <legend style={SR_ONLY}>Values</legend>
            {options.map((o) => (
              <label key={o.id} className="sg-filter-option">
                <input
                  className="sg-checkbox"
                  type="checkbox"
                  checked={draft.multi.includes(o.id)}
                  onChange={(e) =>
                    update({
                      multi: e.target.checked ? [...draft.multi, o.id] : draft.multi.filter((v) => v !== o.id),
                    })
                  }
                />
                {o.label}
              </label>
            ))}
          </fieldset>
        ) : (
          <input
            className={INPUT_CLASS}
            aria-label="Value"
            type="text"
            placeholder="Comma-separated values"
            value={draft.multiText}
            onChange={(e) => update({ multiText: e.target.value })}
          />
        ))}

      {kind === "range" && (
        <>
          <input className={INPUT_CLASS} aria-label="From" placeholder="From" type={inputType} value={draft.from} onChange={(e) => update({ from: e.target.value })} />
          <input className={INPUT_CLASS} aria-label="To" placeholder="To" type={inputType} value={draft.to} onChange={(e) => update({ to: e.target.value })} />
        </>
      )}

      {kind === "relativeDate" && (
        <>
          <select
            className={SELECT_CLASS}
            aria-label="Relative date"
            value={draft.relative}
            onChange={(e) => update({ relative: e.target.value as RelativeDateKind })}
          >
            {RELATIVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {RELATIVE_DATE_LABELS[k]}
              </option>
            ))}
          </select>
          {(draft.relative === "lastNDays" || draft.relative === "nextNDays") && (
            <input className={INPUT_CLASS} aria-label="Number of days" type="number" min={1} value={draft.n} onChange={(e) => update({ n: e.target.value })} />
          )}
        </>
      )}

      {error && (
        <div role="alert" className="sg-filter-error">
          {error}
        </div>
      )}
      </div>

      <div className="sg-filter-actions ag-filter-apply-panel">
        <button type="button" className={BUTTON_CLASS} onClick={clear}>
          Clear
        </button>
        <button type="button" className={`${BUTTON_CLASS} sg-button-primary`} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}
