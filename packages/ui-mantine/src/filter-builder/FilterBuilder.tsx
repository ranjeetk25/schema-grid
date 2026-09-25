import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccessMap } from "../internal/access";
import { readableColumnIds } from "../internal/access";
import {
  type ColumnDef,
  type DataSource,
  type FieldTypeRegistry,
  type FilterNode,
  type FilterOperatorDef,
  type FilterValidationError,
  type GridSchema,
  MAX_FILTER_DEPTH,
  validateFilter,
} from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { FilterGroupEditor } from "./FilterGroupEditor";
import {
  type ConditionPatch,
  DEFAULT_MAX_DEPTH,
  type DraftContext,
  type FilterDraft,
  addCondition as addConditionTo,
  addGroup as addGroupTo,
  canAddGroup as canAddGroupTo,
  filterableColumns,
  fromDraftIndexed,
  operatorsFor,
  removeNode,
  setGroupOp,
  toDraft,
  updateCondition,
} from "./model";

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
}

export interface FilterDraftApi {
  draft: FilterDraft;
  /** Draft node id → inline errors. */
  errors: ReadonlyMap<string, RowErrors>;
  /** Columns offered by the column picker (readable only). */
  columns: ColumnDef[];
  maxDepth: number;
  operatorsForColumnId(columnId: string | null): FilterOperatorDef[];
  addCondition(groupId: string): void;
  addGroup(groupId: string): void;
  remove(id: string): void;
  updateCondition(id: string, patch: ConditionPatch): void;
  setGroupOp(groupId: string, op: "and" | "or"): void;
  canAddGroup(groupId: string): boolean;
}

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
  const { schema, registry, access, value, onChange } = options;
  const maxDepth = Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_FILTER_DEPTH);
  const [draft, setDraft] = useState<FilterDraft>(() => toDraft(value));
  const draftRef = useRef(draft);
  const lastEmitted = useRef(serialize(value));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const ctx: DraftContext = useMemo(() => ({ schema, registry }), [schema, registry]);
  const readable = useMemo(() => readableColumnIds(schema, access), [schema, access]);
  const columns = useMemo(() => filterableColumns(schema, access), [schema, access]);

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
      else if (validateFilter(node, schema, registry, readable).length === 0) out = node;
      if (out === undefined) return;
      const s = serialize(out);
      if (s === lastEmitted.current) return;
      lastEmitted.current = s;
      onChangeRef.current(out);
    },
    [ctx, schema, registry, readable],
  );

  const errors = useMemo(() => {
    const { node, idByPath } = fromDraftIndexed(draft, ctx);
    return node ? errorsToRows(validateFilter(node, schema, registry, readable), idByPath) : new Map<string, RowErrors>();
  }, [draft, ctx, schema, registry, readable]);

  const operatorsForColumnId = useCallback(
    (columnId: string | null) => {
      const column = columnId ? schema.columns.find((c) => c.id === columnId) : undefined;
      return column ? operatorsFor(column, schema, registry) : [];
    },
    [schema, registry],
  );

  return {
    draft,
    errors,
    columns,
    maxDepth,
    operatorsForColumnId,
    addCondition: (groupId) => commit(addConditionTo(draftRef.current, groupId)),
    addGroup: (groupId) => commit(addGroupTo(draftRef.current, groupId, maxDepth)),
    remove: (id) => commit(removeNode(draftRef.current, id)),
    updateCondition: (id, patch) => commit(updateCondition(draftRef.current, id, patch, ctx)),
    setGroupOp: (groupId, op) => commit(setGroupOp(draftRef.current, groupId, op)),
    canAddGroup: (groupId) => canAddGroupTo(draft, groupId, maxDepth),
  };
}

export interface FilterBuilderProps {
  schema: GridSchema;
  /** Core field-type registry (operators, validation). */
  registry: FieldTypeRegistry;
  /** UI registry (value `filterComponent`s). */
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  value: FilterNode | null;
  onChange(node: FilterNode | null): void;
  /** Maximum group nesting; the root group is depth 1. Default 2. */
  maxDepth?: number;
  dataSource?: DataSource;
}

/**
 * AND/OR filter builder over the readable columns of a schema.
 *
 * `onChange` fires only with a complete, `validateFilter`-clean AST (or `null`
 * when no conditions remain); see `useFilterDraft` for the full emission rule.
 * Validation errors show inline on the offending row.
 */
export function FilterBuilder(props: FilterBuilderProps) {
  const { schema, registry, uiRegistry, access, value, onChange, maxDepth, dataSource } = props;
  const api = useFilterDraft({ schema, registry, access, value, onChange, maxDepth });
  return (
    <FilterGroupEditor group={api.draft} depth={1} api={api} schema={schema} uiRegistry={uiRegistry} dataSource={dataSource} />
  );
}
