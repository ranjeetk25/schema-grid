import { CircleAlertIcon } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccessMap } from "../internal/access";
import { readableColumnIds } from "../internal/access";
import {
  type ColorRule,
  type ColumnDef,
  type DataSource,
  type FieldTypeCapabilitiesLike,
  type FieldTypeRegistry,
  type FilterNode,
  type FilterOperatorDef,
  type FilterValidationError,
  type GridSchema,
  MAX_FILTER_DEPTH,
  isFilterGroup,
  validateFilter,
  valueMatchesKind,
} from "../internal/core-contracts";
import { type UiCapabilitiesLike, type UiFieldTypeRegistry, canFilterByColor } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { FilterGroupEditor } from "./FilterGroupEditor";
import type { FilterApplyOptions } from "./filterApplyModel";
import {
  type ConditionPatch,
  DEFAULT_MAX_DEPTH,
  type DraftContext,
  type FilterDraft,
  addCondition as addConditionTo,
  addGroup as addGroupTo,
  canAddGroup as canAddGroupTo,
  colorFilterBlockedReasons,
  filterableColumns,
  findNode,
  findOperator,
  fromDraftIndexed,
  operatorsFor,
  removeNode,
  setGroupOp,
  toDraft,
  updateCondition,
} from "./model";
import { type FilterApplyApi, useFilterApply } from "./useFilterApply";

/** Inline errors of one condition row, by field. */
export interface RowErrors {
  /** Group-level error (e.g. nesting too deep); set on group ids. */
  group?: string;
  column?: string;
  operator?: string;
  value?: string;
}

export interface UseFilterDraftOptions {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: AccessMap;
  value: FilterNode | null;
  onChange(node: FilterNode | null): void;
  maxDepth?: number;
  /**
   * v0.4: `cellColors.filter` adds the color operators (`colorIs` / `colorIsNone`).
   * v0.4.1: `lookup` / `options` gate the value pickers; the `filter` scope /
   * per-column `filterable` feed the `colorRules` check.
   */
  capabilities?: UiCapabilitiesLike | null;
  /** v0.4.1: the view's color rules; a column one of them blocks offers no color operators. */
  colorRules?: readonly ColorRule[];
  /** v0.4.1: pick and validate `filterable: false` columns too (color rule conditions). */
  allowUnfilterable?: boolean;
}

export interface FilterDraftApi {
  draft: FilterDraft;
  /** Draft node id → inline errors. */
  errors: ReadonlyMap<string, RowErrors>;
  /** Columns offered by the column picker (readable; `filterable: false` only when colors filter). */
  columns: ColumnDef[];
  /**
   * Readable column ids. An existing condition on a readable column the
   * picker doesn't offer (`filterable: false`, e.g. from a saved view) still
   * shows its label; hidden columns never do.
   */
  readable?: ReadonlySet<string>;
  maxDepth: number;
  operatorsForColumnId(columnId: string | null): readonly FilterOperatorDef[];
  /** v0.4.1: why the column can't be filtered by color (a color rule blocks it), when color filtering is otherwise on. */
  colorBlockedReason?(columnId: string | null): string | undefined;
  /** v0.4.1: the builder's capabilities, for the value pickers (`lookup` / `options`). */
  capabilities?: FieldTypeCapabilitiesLike;
  addCondition(groupId: string): void;
  /** Adds a nested group seeded with one blank condition. */
  addGroup(groupId: string): void;
  remove(id: string): void;
  updateCondition(id: string, patch: ConditionPatch): void;
  setGroupOp(groupId: string, op: "and" | "or"): void;
  canAddGroup(groupId: string): boolean;
}

const COLORS_ON = { cellColors: { filter: true } } as const;

const serialize = (node: FilterNode | null | undefined) => JSON.stringify(node ?? null);

function errorsToRows(errors: FilterValidationError[], idByPath: Map<string, string>): Map<string, RowErrors> {
  const out = new Map<string, RowErrors>();
  for (const e of errors) {
    const id = idByPath.get(e.path.join("."));
    if (!id) continue;
    const row = out.get(id) ?? {};
    if (e.code === "depthExceeded") row.group ??= e.message;
    else if (e.code === "valueKindMismatch") row.value ??= e.message;
    else if (e.code === "unknownOperator") row.operator ??= e.message;
    else row.column ??= e.message;
    out.set(id, row);
  }
  return out;
}

/**
 * Core validation plus the UI's stricter completeness rule: a blank string is
 * a valid single value for core, but an unfinished draft here.
 */
/** `schema` with `filterable: false` lifted, so `validateFilter` accepts those columns (color rule conditions). */
const withoutUnfilterable = (schema: GridSchema): GridSchema =>
  schema.columns.some((c) => c.filterable === false)
    ? { ...schema, columns: schema.columns.map((c) => (c.filterable === false ? { ...c, filterable: true } : c)) }
    : schema;

function draftErrors(node: FilterNode, ctx: DraftContext, readable: ReadonlySet<string>): FilterValidationError[] {
  const schema = ctx.allowUnfilterable ? withoutUnfilterable(ctx.schema) : ctx.schema;
  const errors = validateFilter(node, schema, ctx.registry, readable);
  const flagged = new Set(errors.map((e) => e.path.join(".")));
  const walk = (n: FilterNode, path: number[]) => {
    if (isFilterGroup(n)) {
      n.children.forEach((c, i) => walk(c, [...path, i]));
      return;
    }
    if (flagged.has(path.join("."))) return;
    const def = findOperator(n.columnId, n.operator, ctx);
    if (def && !valueMatchesKind(def.valueKind, n.value)) {
      errors.push({ code: "valueKindMismatch", path, columnId: n.columnId, operator: n.operator, message: "A value is required" });
    }
  };
  walk(node, []);
  return errors;
}

/**
 * Local draft state for a filter builder, bound to a controlled `value`.
 *
 * Emission rule: on every edit the draft is converted with `fromDraft`, which
 * ignores rows that have no column/operator yet, and checked with core
 * `validateFilter` (readable columns only). `onChange` is called ONLY when that
 * effective AST validates cleanly, or with `null` when it holds no conditions
 * (so removing the last real condition applies even while a blank row
 * remains). Invalid drafts stay local; their errors are exposed per row/group
 * in `errors`. Identical ASTs are not re-emitted. A `value` change from
 * outside (anything other than what was last emitted) resets the draft.
 * `maxDepth` is capped at core's `MAX_FILTER_DEPTH`.
 */
export function useFilterDraft(options: UseFilterDraftOptions): FilterDraftApi {
  const { schema, registry, access, value, onChange, capabilities, colorRules, allowUnfilterable = false } = options;
  const maxDepth = Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_FILTER_DEPTH);
  const [draft, setDraft] = useState<FilterDraft>(() => toDraft(value));
  const draftRef = useRef(draft);
  const lastEmitted = useRef(serialize(value));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Only the flag matters: a new capabilities object with the same answer keeps the context.
  const colors = canFilterByColor(capabilities);
  // v0.4.1: columns a color rule blocks (only matters while colors filter). Keyed by content, so an equal answer keeps the context.
  const blockedKey = useMemo(
    () => (colors ? JSON.stringify([...colorFilterBlockedReasons(schema, colorRules, capabilities)]) : "[]"),
    [colors, schema, colorRules, capabilities],
  );
  const ctx: DraftContext = useMemo(
    () => ({
      schema,
      registry,
      ...(colors ? { capabilities: COLORS_ON } : {}),
      ...(blockedKey !== "[]" ? { blocked: new Map<string, string>(JSON.parse(blockedKey)) } : {}),
      ...(allowUnfilterable ? { allowUnfilterable } : {}),
    }),
    [schema, registry, colors, blockedKey, allowUnfilterable],
  );
  const readable = useMemo(() => readableColumnIds(schema, access), [schema, access]);
  const columns = useMemo(
    () => filterableColumns(schema, access, ctx.capabilities, ctx.blocked, ctx.allowUnfilterable),
    [schema, access, ctx],
  );

  useEffect(() => {
    const incoming = serialize(value);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    const next = toDraft(value);
    draftRef.current = next;
    setDraft(next);
  }, [value]);

  const commit = useCallback(
    (next: FilterDraft) => {
      if (next === draftRef.current) return;
      draftRef.current = next;
      setDraft(next);
      const { node } = fromDraftIndexed(next, ctx);
      let out: FilterNode | null | undefined;
      if (!node) out = null;
      else if (draftErrors(node, ctx, readable).length === 0) out = node;
      if (out === undefined) return;
      const s = serialize(out);
      if (s === lastEmitted.current) return;
      lastEmitted.current = s;
      onChangeRef.current(out);
    },
    [ctx, readable],
  );

  const errors = useMemo(() => {
    const { node, idByPath } = fromDraftIndexed(draft, ctx);
    return node ? errorsToRows(draftErrors(node, ctx, readable), idByPath) : new Map<string, RowErrors>();
  }, [draft, ctx, readable]);

  const operatorsForColumnId = useCallback(
    (columnId: string | null) => {
      const column = columnId ? schema.columns.find((c) => c.id === columnId) : undefined;
      return column ? operatorsFor(column, registry, ctx.capabilities, ctx.blocked) : [];
    },
    [schema, registry, ctx],
  );
  const colorBlockedReason = useCallback((columnId: string | null) => (columnId ? ctx.blocked?.get(columnId) : undefined), [ctx]);
  const pickerCapabilities = capabilities ? { lookup: capabilities.lookup, options: capabilities.options } : undefined;

  const addGroup = (groupId: string) => {
    const next = addGroupTo(draftRef.current, groupId, maxDepth);
    if (next === draftRef.current) return;
    const parent = findNode(next, groupId);
    const created = parent?.kind === "group" ? parent.children.at(-1) : undefined;
    commit(created?.kind === "group" ? addConditionTo(next, created.id) : next);
  };

  return {
    draft,
    errors,
    columns,
    readable,
    maxDepth,
    operatorsForColumnId,
    colorBlockedReason,
    ...(pickerCapabilities ? { capabilities: pickerCapabilities } : {}),
    addCondition: (groupId) => commit(addConditionTo(draftRef.current, groupId)),
    addGroup,
    remove: (id) => commit(removeNode(draftRef.current, id)),
    updateCondition: (id, patch) => commit(updateCondition(draftRef.current, id, patch, ctx)),
    setGroupOp: (groupId, op) => commit(setGroupOp(draftRef.current, groupId, op)),
    canAddGroup: (groupId) => canAddGroupTo(draft, groupId, maxDepth),
  };
}

export interface FilterBuilderProps extends FilterApplyOptions {
  schema: GridSchema;
  /** Core field-type registry (operators, validation). */
  registry: FieldTypeRegistry;
  /** UI registry (value inputs derived from its editor widgets). */
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  /** The APPLIED filter (controlled). */
  value: FilterNode | null;
  /** Receives each applied filter: debounced in live mode, on "Apply filter" in explicit mode. */
  onChange(node: FilterNode | null): void;
  /** Maximum group nesting; the root group is depth 1. Default 2. */
  maxDepth?: number;
  dataSource?: DataSource;
  /** Last apply failure (e.g. a server error); shown inline while the previous filter stays applied. */
  error?: string | null;
  /** Reports the working draft (last valid) and whether it differs from `value`. */
  onDraftChange?(draft: FilterNode | null, dirty: boolean): void;
  /**
   * v0.4: the source's capabilities (`handle.effectiveCapabilities`). With
   * `cellColors.filter`, every column offers "color is" / "has no color".
   * v0.4.1: `lookup` / `options` gate the value pickers (no search is called
   * without them).
   */
  capabilities?: UiCapabilitiesLike | null;
  /**
   * v0.4.1: the view's color rules (`handle.colorRules`). A column one of them
   * blocks (a rule that can color it tests a column the server can't filter
   * on) offers no color operators; the operator list says why.
   */
  colorRules?: readonly ColorRule[];
  /**
   * v0.4.1: offer and accept `filterable: false` columns with their own
   * operators. For conditions evaluated client-side, like the color rules
   * dialog's rule conditions; a grid filter should leave it off.
   */
  allowUnfilterable?: boolean;
}

/** Calls `onDraftChange` whenever the apply state's draft/dirty change (not on mount). */
export function useReportDraft(apply: FilterApplyApi, onDraftChange?: (draft: FilterNode | null, dirty: boolean) => void) {
  const cb = useRef(onDraftChange);
  cb.current = onDraftChange;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    cb.current?.(apply.draft, apply.dirty);
  }, [apply.draft, apply.dirty]);
}

export interface FilterBuilderPanelProps extends Omit<FilterBuilderProps, keyof FilterApplyOptions | "value" | "onChange" | "onDraftChange"> {
  apply: FilterApplyApi;
  /** "popover": padded body + full-bleed footer band; "inline": unpadded. */
  variant?: "inline" | "popover";
  className?: string;
}

/** The builder body bound to an apply state (shared by FilterBuilder and FilterButton). */
export function FilterBuilderPanel({
  schema,
  registry,
  uiRegistry,
  access,
  maxDepth,
  dataSource,
  error,
  apply,
  variant = "inline",
  className,
  capabilities,
  colorRules,
  allowUnfilterable,
}: FilterBuilderPanelProps) {
  const api = useFilterDraft({
    schema,
    registry,
    access,
    value: apply.draft,
    onChange: apply.setDraft,
    maxDepth,
    capabilities,
    colorRules,
    allowUnfilterable,
  });
  const popover = variant === "popover";
  const pending = apply.pendingChanges;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!apply.live && e.key === "Enter" && (e.metaKey || e.ctrlKey) && apply.dirty) {
      e.preventDefault();
      apply.apply();
    }
  };

  return (
    <div className={cn(SG_ROOT, "sg:flex sg:min-w-0 sg:flex-col", className)} onKeyDown={onKeyDown}>
      <div className={cn("sg:flex sg:flex-col sg:gap-3", popover && "sg:p-4")}>
        <FilterGroupEditor group={api.draft} depth={1} api={api} schema={schema} uiRegistry={uiRegistry} dataSource={dataSource} />
        {error ? (
          <p role="alert" className="sg:flex sg:items-start sg:gap-1.5 sg:text-xs sg:text-danger">
            <CircleAlertIcon aria-hidden className="sg:mt-px sg:size-3.5 sg:shrink-0" />
            <span>{`Couldn't apply filter: ${error}`}</span>
          </p>
        ) : null}
      </div>
      {apply.live ? null : (
        <div
          className={cn(
            "sg:flex sg:items-center sg:justify-between sg:gap-3 sg:border-t sg:border-border",
            popover ? "sg:rounded-b-lg sg:bg-subtle sg:px-4 sg:py-2.5" : "sg:mt-3 sg:pt-3",
          )}
        >
          <span className="sg:text-xs sg:text-muted-foreground sg:tabular-nums" aria-live="polite">
            {pending > 0 ? `${pending} ${pending === 1 ? "change" : "changes"} not applied` : "Large table: filters apply on demand"}
          </span>
          <div className="sg:flex sg:items-center sg:gap-2">
            <Button variant="ghost" size="sm" disabled={!apply.dirty} onClick={apply.discard}>
              Discard
            </Button>
            <Button variant="primary" size="sm" disabled={!apply.dirty} onClick={apply.apply} aria-keyshortcuts="Control+Enter Meta+Enter">
              Apply filter
              <Kbd aria-hidden className="sg:border-transparent sg:bg-primary-hover sg:text-primary-foreground">
                ⌘↵
              </Kbd>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AND/OR filter builder over the readable columns of a schema.
 *
 * Edits reach `onChange` through `useFilterApply`: live (debounced
 * `debounceMs`, default 300ms) while the table is small — `rowCount` unknown
 * or ≤ `liveFilterThreshold` — otherwise on an explicit "Apply filter".
 * Only complete, `validateFilter`-clean ASTs (or `null`) are ever applied;
 * see `useFilterDraft`. Validation errors show inline on the offending row.
 * `debounceMs={0}` applies synchronously.
 */
export function FilterBuilder(props: FilterBuilderProps) {
  const { value, onChange, mode, rowCount, liveFilterThreshold, debounceMs, onDraftChange, ...panel } = props;
  const apply = useFilterApply({ value, onApply: onChange, mode, rowCount, liveFilterThreshold, debounceMs });
  useReportDraft(apply, onDraftChange);
  return <FilterBuilderPanel {...panel} apply={apply} />;
}
