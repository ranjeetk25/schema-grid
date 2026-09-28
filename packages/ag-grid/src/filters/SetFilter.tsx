import { useEffect, useMemo, useState } from "react";
import type { ColDef, Column } from "ag-grid-community";
import { useGridFilter } from "ag-grid-react";
import { CELL_COLORS, type CellColor, type FilterCondition, type GridRow, isCellColor } from "../internal/core";
import { getSchemaGridContext } from "../grid/gridContext";
import { CELL_COLOR_TOKENS } from "../theme/cellColorTokens";
import { canFilterByColor, capabilitiesOf, colorFilterBlockedReasonOf } from "./colorOperators";
import {
  configOptions,
  type FilterOption,
  INPUT_CLASS,
  resolveFilterColumn,
  type SchemaFilterProps,
  SELECT_CLASS,
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
 *
 * v0.4: with `context.effectiveCapabilities.cellColors.filter`, a "Filter by"
 * select switches to a Color mode: palette checkboxes emit `colorIs`, the
 * exclusive "No color" emits `colorIsNone`. A color model opens in that mode.
 * Not offered on a column a color rule blocks (v0.4.1, `colorFilterBlockedReason`).
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
  // v0.4.1: no Color mode on a column a view color rule blocks (see `colorFilterBlockedReason`).
  const colorAllowed =
    canFilterByColor(capabilitiesOf(props.context)) &&
    !(resolved && colorFilterBlockedReasonOf(props.context, resolved.column) !== null);
  const modelIsColor = model?.operator === "colorIs" || model?.operator === "colorIsNone";
  const [mode, setMode] = useState<"values" | "color">(modelIsColor ? "color" : "values");
  // A color model set from outside (builder / view / header menu) shows the Color mode.
  useEffect(() => {
    if (modelIsColor) setMode("color");
  }, [modelIsColor]);

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

  if (colorAllowed && mode === "color") {
    const noColor = model?.operator === "colorIsNone";
    const colors: CellColor[] =
      model?.operator === "colorIs" && Array.isArray(model.value) ? model.value.filter(isCellColor) : [];
    const emitColors = (next: CellColor[]) =>
      onModelChange(next.length > 0 ? { columnId: resolved.columnId, operator: "colorIs", value: next } : null);
    return (
      <div className="sg-filter sg-set-filter">
        <div className="sg-filter-body ag-filter-body-wrapper">
          <FilterBySelect mode={mode} onChange={setMode} />
          <fieldset className="sg-filter-options sg-color-options" style={FIELDSET_RESET}>
            <legend style={SR_ONLY}>{`${resolved.column.label} colors`}</legend>
            <label className="sg-filter-option">
              <input
                className="sg-checkbox"
                type="checkbox"
                checked={noColor}
                onChange={(e) =>
                  onModelChange(e.target.checked ? { columnId: resolved.columnId, operator: "colorIsNone" } : null)
                }
              />
              No color
            </label>
            {CELL_COLORS.map((c) => (
              <label key={c} className="sg-filter-option">
                <input
                  className="sg-checkbox"
                  type="checkbox"
                  checked={colors.includes(c)}
                  onChange={(e) => emitColors(e.target.checked ? [...colors, c] : colors.filter((x) => x !== c))}
                />
                <span className="sg-color-swatch" aria-hidden="true" style={{ backgroundColor: CELL_COLOR_TOKENS[c].swatch }} />
                {CELL_COLOR_TOKENS[c].label}
              </label>
            ))}
          </fieldset>
        </div>
      </div>
    );
  }

  const options = loaded && loaded.length > 0 ? loaded : staticOptions;
  const selected = modelIsColor ? [] : selectedFrom(model, isBoolean);
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
      <div className="sg-filter-body ag-filter-body-wrapper">
        {colorAllowed && <FilterBySelect mode={mode} onChange={setMode} />}
        {!isBoolean && (
          <input
            className={INPUT_CLASS}
            aria-label="Search options"
            placeholder="Search…"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        <fieldset className="sg-filter-options" style={FIELDSET_RESET}>
          <legend style={SR_ONLY}>
            {`${resolved.column.label} values`}
          </legend>
          {visible.map((o) => (
            <label key={o.id} className="sg-filter-option">
              <input
                className="sg-checkbox"
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={(e) => toggle(o.id, e.target.checked)}
              />
              {o.label}
            </label>
          ))}
          {visible.length === 0 && <div className="sg-filter-empty">No options</div>}
        </fieldset>
      </div>
    </div>
  );
}

const FIELDSET_RESET = { border: 0, margin: 0, padding: 0, minWidth: 0 } as const;
const SR_ONLY = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/** v0.4: "Filter by: Values | Color" (only rendered when the source can filter by color). */
function FilterBySelect(props: { mode: "values" | "color"; onChange(mode: "values" | "color"): void }) {
  return (
    <select
      className={SELECT_CLASS}
      aria-label="Filter by"
      value={props.mode}
      onChange={(e) => props.onChange(e.target.value === "color" ? "color" : "values")}
    >
      <option value="values">Values</option>
      <option value="color">Color</option>
    </select>
  );
}
