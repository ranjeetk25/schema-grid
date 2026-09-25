import { Avatar, Box, Button, Checkbox, ScrollArea, Stack, TextInput, useMantineTheme } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { FilterCondition, GridRow } from "../internal/core-contracts";
import { resolveOptionColor } from "../internal/options";
import { ColumnFilterHeader } from "./MantineConditionFilter";
import { COLUMN_FILTER_CSS } from "./columnFilterStyles";
import {
  PASS_ALL_FILTER_METHODS,
  type SchemaFilterProps,
  getSchemaGridContext,
  resolveFilterColumn,
  useGridFilter,
} from "./contracts";
import { type ColumnFilterOption, filterOptions, toColumnFilterOptions } from "./options";

const BOOLEAN_OPTIONS: ColumnFilterOption[] = [
  { id: "true", label: "Checked" },
  { id: "false", label: "Unchecked" },
];

/** Which ids a model selects, for the set operators this filter emits (same as ag-grid's `SetFilter`). */
export function selectedFromModel(model: FilterCondition | null | undefined, isBoolean: boolean): string[] {
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

/** Selection → model: `isAnyOf` (select/user), `hasAnyOf` (multiSelect), `isTrue`/`isFalse` (boolean); empty → null. */
export function setFilterModel(
  columnId: string,
  kind: { isBoolean: boolean; isMulti: boolean },
  next: readonly string[],
): FilterCondition | null {
  if (next.length === 0) return null;
  if (kind.isBoolean) {
    const t = next.includes("true");
    const f = next.includes("false");
    return t === f ? null : { columnId, operator: t ? "isTrue" : "isFalse" };
  }
  return { columnId, operator: kind.isMulti ? "hasAnyOf" : "isAnyOf", value: [...next] };
}

/**
 * Distinct cell values of the loaded rows as options (`{ id, name }` users,
 * `{ id, label }` refs or primitives), sorted by label.
 */
export function distinctRowOptions(
  api: { forEachNode?(cb: (node: never) => void): void } | undefined,
  getValue: ((node: never) => unknown) | undefined,
): ColumnFilterOption[] {
  if (!api?.forEachNode || !getValue) return [];
  const seen = new Map<string, ColumnFilterOption>();
  const add = (v: unknown) => {
    if (v === null || v === undefined || v === "") return;
    if (typeof v === "object") {
      const o = v as { id?: unknown; name?: unknown; label?: unknown; avatarUrl?: unknown };
      if (o.id === undefined || o.id === null) return;
      const id = String(o.id);
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          label: String(o.name ?? o.label ?? id),
          ...(typeof o.avatarUrl === "string" ? { avatarUrl: o.avatarUrl } : {}),
        });
      }
      return;
    }
    const id = String(v);
    if (!seen.has(id)) seen.set(id, { id, label: id });
  };
  try {
    api.forEachNode((node) => {
      const v = getValue(node);
      if (Array.isArray(v)) v.forEach(add);
      else add(v);
    });
  } catch {
    return [];
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Rule 9: unavailable ghost actions are 40% opacity, no fill. */
const DISABLED = { background: "transparent", opacity: 0.4 } as const;

function colorVar(color: string): string {
  return /^(#|rgb|hsl|var\()/i.test(color) ? color : `var(--mantine-color-${color}-filled)`;
}

/**
 * Mantine column filter for set-like types (select, multiSelect, user,
 * boolean): a search field, "Select all / Clear" links, a scrollable checkbox
 * list (option colour dots, user initials) and a count footer. Every toggle
 * applies immediately, exactly like ag-grid's `SetFilter`. Options come from
 * `context.dataSource.getOptions(columnId)` once per mount, falling back to
 * the column's static `config.options`.
 */
export function MantineSetFilter<Row extends GridRow = GridRow>(props: SchemaFilterProps<Row>) {
  const { model, onModelChange } = props;
  useGridFilter(PASS_ALL_FILTER_METHODS);
  const theme = useMantineTheme();
  const resolved = resolveFilterColumn({
    schemaColumn: props.schemaColumn,
    fieldType: props.fieldType,
    colDef: props.colDef as never,
    column: props.column as never,
  });
  const isBoolean = resolved?.fieldType.id === "boolean";
  const isUser = resolved?.fieldType.id === "user";
  const isMulti = resolved?.column.type === "multiSelect" || resolved?.fieldType.id === "multiSelect";
  const staticOptions = useMemo(
    () => (isBoolean ? BOOLEAN_OPTIONS : filterOptions(resolved?.config)),
    [isBoolean, resolved?.config],
  );
  const [loaded, setLoaded] = useState<ColumnFilterOption[] | null>(null);
  const [search, setSearch] = useState("");

  const columnId = resolved?.columnId;
  // Load options ONCE per mount (not per model change / re-render). Without a
  // data-source answer, fall back to the distinct values of the loaded rows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only.
  useEffect(() => {
    if (isBoolean || !columnId) return;
    const fromRows = () => distinctRowOptions(props.api as never, props.getValue as never);
    const dataSource = getSchemaGridContext(props.context)?.dataSource;
    if (!dataSource?.getOptions) {
      if (staticOptions.length === 0) setLoaded(fromRows());
      return;
    }
    let cancelled = false;
    dataSource.getOptions(columnId).then(
      (opts) => {
        if (cancelled) return;
        const list = toColumnFilterOptions(opts);
        setLoaded(list.length > 0 || staticOptions.length > 0 ? list : fromRows());
      },
      () => {
        if (!cancelled && staticOptions.length === 0) setLoaded(fromRows());
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!resolved) return null;
  const options = loaded && loaded.length > 0 ? loaded : staticOptions;
  const selected = selectedFromModel(model, isBoolean);
  const needle = search.trim().toLowerCase();
  const visible = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const emit = (next: string[]) => onModelChange(setFilterModel(resolved.columnId, { isBoolean, isMulti }, next));
  const toggle = (id: string, checked: boolean) =>
    emit(checked ? [...selected.filter((s) => s !== id), id] : selected.filter((s) => s !== id));
  const selectAll = () => emit([...new Set([...selected, ...visible.map((o) => o.id)])]);

  const marker = (o: ColumnFilterOption) => {
    if (isUser) {
      return (
        <Avatar src={o.avatarUrl} size={18} radius="xl" color="gray" variant="light" aria-hidden styles={{ placeholder: { fontSize: 9 } }}>
          {o.label.trim().charAt(0).toUpperCase()}
        </Avatar>
      );
    }
    if (!o.color) return null;
    return <span className="sg-cf-dot" aria-hidden style={{ background: colorVar(resolveOptionColor(o, theme)) }} />;
  };

  return (
    <div className="sg-cf sg-cf-set">
      <style>{COLUMN_FILTER_CSS}</style>
      <Stack gap={8} p="12px 12px 6px">
        <ColumnFilterHeader resolved={resolved} />
        {isBoolean ? null : (
          <TextInput
            aria-label="Search options"
            placeholder="Search…"
            size="xs"
            data-autofocus
            leftSection={<IconSearch size={14} stroke={1.75} aria-hidden />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        )}
      </Stack>
      <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend className="sg-cf-sr" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {`${resolved.column.label} values`}
        </legend>
        <ScrollArea.Autosize mah={240} type="auto" offsetScrollbars="y">
          <div className="sg-cf-list">
            {visible.map((o) => (
              <Box component="label" key={o.id} className="sg-cf-option">
                <Checkbox
                  size="xs"
                  checked={selected.includes(o.id)}
                  onChange={(e) => toggle(o.id, e.currentTarget.checked)}
                  styles={{ input: { cursor: "pointer" } }}
                />
                {marker(o)}
                <span className="sg-cf-option-label">{o.label}</span>
              </Box>
            ))}
          </div>
        </ScrollArea.Autosize>
        {visible.length === 0 ? <div className="sg-cf-empty">{needle ? "No matching options" : "No options"}</div> : null}
      </fieldset>
      <Box className="sg-cf-footer">
        <span className="sg-cf-footer-text">
          {selected.length > 0 ? `${selected.length} of ${options.length} selected` : `${options.length} options`}
        </span>
        <div className="sg-cf-links">
          {isBoolean ? null : (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={selectAll}
              disabled={visible.length === 0}
              style={visible.length === 0 ? DISABLED : undefined}
            >
              Select all
            </Button>
          )}
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => emit([])}
            disabled={selected.length === 0}
            style={selected.length === 0 ? DISABLED : undefined}
          >
            Clear
          </Button>
        </div>
      </Box>
    </div>
  );
}
