import { SearchIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { ToneDot } from "../editors/EditorCard";
import type { FilterCondition } from "../internal/core-contracts";
import { type SchemaFilterProps, getSchemaGridContext, resolveFilterColumn, useGridFilter } from "../internal/grid-contracts";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { type FilterChoice, FilterShell, PASS_ALL_FILTER_METHODS, choiceAsOption, configChoices, toChoices } from "./filterShared";

const BOOLEAN_CHOICES: FilterChoice[] = [
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
 * Searchable checkbox list for select, multiSelect, user and boolean
 * columns (Radix checkboxes, option tone dots / user avatars). Options come
 * from `context.dataSource.getOptions(columnId)` once per mount (falling back
 * to the column's static `config.options`). Every toggle emits, exactly like
 * ag-grid's `SetFilter`: `isAnyOf` (select/user), `hasAnyOf` (multiSelect),
 * `isTrue` / `isFalse` (boolean; null for both or neither). An empty
 * selection emits null.
 */
export function ShadcnSetFilter(props: SchemaFilterProps) {
  const { model, onModelChange } = props;
  useGridFilter(PASS_ALL_FILTER_METHODS);
  const id = useId();

  const resolved = resolveFilterColumn({
    schemaColumn: props.schemaColumn,
    fieldType: props.fieldType,
    colDef: props.colDef as never,
    column: props.column as never,
  });
  const isBoolean = resolved?.fieldType.id === "boolean";
  const isUser = resolved?.fieldType.id === "user";
  const staticChoices = useMemo(() => (isBoolean ? BOOLEAN_CHOICES : configChoices(resolved?.config)), [isBoolean, resolved?.config]);
  const [loaded, setLoaded] = useState<FilterChoice[] | null>(null);
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
        if (!cancelled) setLoaded(toChoices(opts));
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

  const choices = loaded && loaded.length > 0 ? loaded : staticChoices;
  const selected = selectedFrom(model, isBoolean);
  const needle = search.trim().toLowerCase();
  const visible = needle ? choices.filter((o) => o.label.toLowerCase().includes(needle)) : choices;

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

  const toggle = (choiceId: string, checked: boolean) => {
    emit(checked ? [...selected.filter((s) => s !== choiceId), choiceId] : selected.filter((s) => s !== choiceId));
  };

  return (
    <FilterShell
      className="sg-set-filter sg:w-[248px]"
      footer={
        <>
          <span className="sg:px-1 sg:text-xs sg:text-muted-foreground sg:tabular-nums">
            {selected.length > 0 ? `${selected.length} selected` : "All values"}
          </span>
          <Button variant="ghost" size="xs" disabled={selected.length === 0} onClick={() => onModelChange(null)}>
            Clear
          </Button>
        </>
      }
    >
      {!isBoolean ? (
        <div className="sg:flex sg:h-9 sg:items-center sg:gap-2 sg:border-b sg:border-border sg:px-2.5">
          <SearchIcon aria-hidden className="sg:size-3.5 sg:shrink-0 sg:text-faint-foreground" />
          <input
            aria-label="Search options"
            type="search"
            value={search}
            placeholder="Search…"
            className="sg:h-full sg:w-full sg:bg-transparent sg:text-sm sg:outline-none sg:placeholder:text-faint-foreground sg:[&::-webkit-search-cancel-button]:hidden"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      ) : null}
      <fieldset className="sg:m-0 sg:flex sg:min-w-0 sg:max-h-64 sg:flex-col sg:overflow-y-auto sg:border-0 sg:p-1">
        <legend className="sg:sr-only">{`${resolved.column.label} values`}</legend>
        {visible.map((c) => {
          const boxId = `${id}-${c.id}`;
          return (
            <label
              key={c.id}
              htmlFor={boxId}
              className="sg:flex sg:h-[30px] sg:shrink-0 sg:cursor-default sg:items-center sg:gap-2 sg:rounded-md sg:px-2 sg:text-sm sg:select-none sg:hover:bg-muted"
            >
              <Checkbox id={boxId} checked={selected.includes(c.id)} onCheckedChange={(next) => toggle(c.id, next === true)} />
              {isUser ? <Avatar name={c.label} src={c.avatarUrl ?? null} size="xs" /> : !isBoolean ? <ToneDot option={choiceAsOption(c)} /> : null}
              <span className="sg:min-w-0 sg:truncate">{c.label}</span>
            </label>
          );
        })}
        {visible.length === 0 ? <div className="sg:px-2 sg:py-4 sg:text-center sg:text-sm sg:text-muted-foreground">No options</div> : null}
      </fieldset>
    </FilterShell>
  );
}
