import { useEffect, useMemo, useState } from "react";
import type { ColDef, Column } from "ag-grid-community";
import { useGridFilter } from "ag-grid-react";
import type { FilterCondition, GridRow } from "../internal/core";
import { getSchemaGridContext } from "../grid/gridContext";
import {
  configOptions,
  type FilterOption,
  resolveFilterColumn,
  type SchemaFilterProps,
  toFilterOptions,
} from "./ConditionFilter";

const BOOLEAN_OPTIONS: FilterOption[] = [
  { id: "true", label: "Checked" },
  { id: "false", label: "Unchecked" },
];

/** Which ids a model selects, for the set operators this filter emits. */
function selectedFrom(model: FilterCondition | null, isBoolean: boolean): string[] {
  if (!model) return [];
  if (isBoolean) {
    if (model.operator === "isTrue") return ["true"];
    if (model.operator === "isFalse") return ["false"];
    return [];
  }
  if ((model.operator === "isAnyOf" || model.operator === "hasAnyOf") && Array.isArray(model.value)) {
    return model.value.map((v) => String(v));
  }
  if (model.operator === "is" && (typeof model.value === "string" || typeof model.value === "number")) {
    return [String(model.value)];
  }
  return [];
}

/**
 * Stable across renders: ag-grid-react treats a new `doesFilterPass` identity on a
 * re-render of an active filter as "the filter logic changed" and fires a spurious
 * `filterChanged`, which resets the infinite row model (a duplicate server fetch).
 */
const PASS_ALL_FILTER_METHODS = { doesFilterPass: () => true };

/**
 * Searchable checkbox list for select, multiSelect, user and boolean columns.
 * Options come from `context.dataSource.getOptions(columnId)` once per mount
 * (falling back to the column's static `config.options`). Every toggle emits:
 * `isAnyOf` (select/user), `hasAnyOf` (multiSelect), `isTrue`/`isFalse`
 * (boolean, null when both or neither). An empty selection emits null.
 */
export function SetFilter<Row extends GridRow = GridRow>(props: SchemaFilterProps<Row>) {
  const { model, onModelChange } = props;
  useGridFilter(PASS_ALL_FILTER_METHODS);

  const resolved = resolveFilterColumn({
    schemaColumn: props.schemaColumn,
    fieldType: props.fieldType,
    colDef: props.colDef as ColDef<GridRow> | undefined,
    column: props.column as Column | undefined,
  });
  const isBoolean = resolved?.fieldType.id === "boolean";
  const staticOptions = useMemo(
    () => (isBoolean ? BOOLEAN_OPTIONS : configOptions(resolved?.config)),
    [isBoolean, resolved?.config],
  );
  const [loaded, setLoaded] = useState<FilterOption[] | null>(null);
  const [search, setSearch] = useState("");

  const columnId = resolved?.columnId;
  // Load options ONCE per mount (not per model change / re-render).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only.
  useEffect(() => {
    if (isBoolean || !columnId) return;
    const getOptions = getSchemaGridContext(props.context)?.dataSource.getOptions;
    if (!getOptions) return;
    let cancelled = false;
    getOptions(columnId).then(
      (opts) => {
        if (!cancelled) setLoaded(toFilterOptions(opts));
      },
      () => {
        // Keep the static options on failure.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!resolved) return null;

  const options = loaded && loaded.length > 0 ? loaded : staticOptions;
  const selected = selectedFrom(model, isBoolean);
  const needle = search.trim().toLowerCase();
  const visible = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  const emit = (next: string[]) => {
    if (next.length === 0) {
      onModelChange(null);
      return;
    }
    if (isBoolean) {
      const hasTrue = next.includes("true");
      const hasFalse = next.includes("false");
      if (hasTrue === hasFalse) onModelChange(null);
      else onModelChange({ columnId: resolved.columnId, operator: hasTrue ? "isTrue" : "isFalse" });
      return;
    }
    const operator = resolved.column.type === "multiSelect" || resolved.fieldType.id === "multiSelect" ? "hasAnyOf" : "isAnyOf";
    onModelChange({ columnId: resolved.columnId, operator, value: next });
  };

  const toggle = (id: string, checked: boolean) => {
    emit(checked ? [...selected.filter((s) => s !== id), id] : selected.filter((s) => s !== id));
  };

  return (
    <div className="sg-filter sg-set-filter">
      {!isBoolean && (
        <input aria-label="Search options" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      )}
      <fieldset className="sg-filter-options" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
          {`${resolved.column.label} values`}
        </legend>
        {visible.map((o) => (
          <label key={o.id}>
            <input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
            {o.label}
          </label>
        ))}
        {visible.length === 0 && <div className="sg-filter-empty">No options</div>}
      </fieldset>
    </div>
  );
}
