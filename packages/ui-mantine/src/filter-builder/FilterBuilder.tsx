import { Alert, Box, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle } from "../internal/icons";
import { type KeyboardEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
import { FILTER_BUILDER_CSS } from "./filterBuilderStyles";
import {
  type ApplyModeInput,
  DEFAULT_LIVE_FILTER_DEBOUNCE_MS,
  type FilterApplyMode,
  type FilterTimer,
  LiveFilterController,
  type LiveFilterState,
  applicableFilter,
  resolveApplyMode,
} from "./liveFilter";
import {
  type ConditionPatch,
  DEFAULT_MAX_DEPTH,
  type DraftContext,
  type FilterDraft,
  addCondition as addConditionTo,
  addGroup as addGroupTo,
  canAddGroup as canAddGroupTo,
  countConditions,
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

/** Live/explicit state of a builder, reported to hosts (the FilterButton badge uses it). */
export interface FilterBuilderStatus {
  mode: FilterApplyMode;
  /** A live apply is scheduled (debouncing) or an apply is in flight. */
  pending: boolean;
  /** Explicit mode: the draft has changes that are not applied yet. */
  dirty: boolean;
  /** The last apply failed (or the host passed `error`). */
  error: string | null;
}

export interface UseFilterDraftOptions extends ApplyModeInput {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: AccessMap;
  /** The APPLIED filter (controlled). */
  value: FilterNode | null;
  /** Applies a filter. May return a Promise: a rejection keeps the previous filter and shows the error. */
  onChange(node: FilterNode | null): unknown;
  maxDepth?: number;
  /** Live-mode debounce. Default 300ms; 0 applies synchronously. */
  debounceMs?: number;
  /** Injectable timer (tests). */
  timer?: FilterTimer;
  onStatusChange?(status: FilterBuilderStatus): void;
}

export interface FilterDraftApi {
  draft: FilterDraft;
  /** Draft node id → inline errors. */
  errors: ReadonlyMap<string, RowErrors>;
  /** Columns offered by the column picker (readable, not `filterable: false`). */
  columns: ColumnDef[];
  /**
   * Readable column ids. An existing condition on a readable column the
   * picker doesn't offer (`filterable: false`, e.g. from a saved view) still
   * shows its label; hidden columns never do.
   */
  readable?: ReadonlySet<string>;
  maxDepth: number;
  operatorsForColumnId(columnId: string | null): readonly FilterOperatorDef[];
  addCondition(groupId: string): void;
  addGroup(groupId: string): void;
  remove(id: string): void;
  updateCondition(id: string, patch: ConditionPatch): void;
  setGroupOp(groupId: string, op: "and" | "or"): void;
  canAddGroup(groupId: string): boolean;
  /** Apply the draft now (explicit Apply / Enter; flushes a live debounce). */
  apply(): void;
  /** Live mode: apply a debouncing edit now (e.g. its popover closed). */
  flush(): void;
  /** Drop every condition and apply `null`. */
  clear(): void;
  status: FilterBuilderStatus;
  /** Id of the condition added last (so its column picker can take focus). */
  lastAddedId: string | null;
}

function errorsToRows(errors: FilterValidationError[], idByPath: Map<string, string>): Map<string, RowErrors> {
  const out = new Map<string, RowErrors>();
  for (const e of errors) {
    const id = idByPath.get(e.path.join("."));
    if (!id) continue;
    const row = out.get(id) ?? {};
    if (e.code === "depthExceeded") row.group ??= e.message;
    else if (e.code === "unknownOperator") row.operator ??= e.message;
    else row.column ??= e.message;
    out.set(id, row);
  }
  return out;
}

const toStatus = (s: LiveFilterState, hostError: string | null | undefined): FilterBuilderStatus => ({
  mode: s.mode,
  pending: s.status === "scheduled" || s.status === "applying",
  dirty: s.mode === "explicit" && s.dirty,
  error: hostError || s.error,
});

const sameStatus = (a: FilterBuilderStatus, b: FilterBuilderStatus) =>
  a.mode === b.mode && a.pending === b.pending && a.dirty === b.dirty && a.error === b.error;

/**
 * Local draft state for a filter builder, bound to a controlled (applied)
 * `value`.
 *
 * Emission rule: on every edit the draft is converted with `fromDraft` and
 * pruned with `pruneIncomplete` (rows without a column / operator / required
 * value never reach `onChange`). A pruned filter that still fails core
 * `validateFilter` (readable columns only) is not applied; its errors show on
 * the offending rows. Applying is LIVE (debounced `debounceMs`) or EXPLICIT
 * (Apply button / Enter) — see `resolveApplyMode` in `./liveFilter`.
 * Identical filters are not re-emitted. A `value` change from outside
 * (anything other than what was applied / is being applied) resets the draft.
 * A pending live apply is flushed on unmount. `maxDepth` is capped at core's
 * `MAX_FILTER_DEPTH`.
 */
export function useFilterDraft(options: UseFilterDraftOptions & { error?: string | null }): FilterDraftApi {
  const { schema, registry, access, value, onChange } = options;
  const maxDepth = Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_FILTER_DEPTH);
  const mode = resolveApplyMode(options);
  const [draft, setDraft] = useState<FilterDraft>(() => toDraft(value));
  const draftRef = useRef(draft);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const ctx: DraftContext = useMemo(() => ({ schema, registry }), [schema, registry]);
  const readable = useMemo(() => readableColumnIds(schema, access), [schema, access]);
  const columns = useMemo(() => filterableColumns(schema, access), [schema, access]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [liveState, setLiveState] = useState<LiveFilterState | null>(null);
  const controllerRef = useRef<LiveFilterController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new LiveFilterController({
      value,
      mode,
      debounceMs: options.debounceMs ?? DEFAULT_LIVE_FILTER_DEBOUNCE_MS,
      timer: options.timer,
      apply: (node) => onChangeRef.current(node),
      onState: setLiveState,
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.setMode(mode);
  }, [controller, mode]);

  // Flush a pending live apply when the builder goes away (e.g. its popover unmounts).
  useEffect(() => () => controller.dispose({ flush: true }), [controller]);

  useEffect(() => {
    if (controller.setValue(value)) {
      const next = toDraft(value);
      draftRef.current = next;
      setDraft(next);
    }
  }, [controller, value]);

  const commit = useCallback(
    (next: FilterDraft) => {
      if (next === draftRef.current) return;
      draftRef.current = next;
      setDraft(next);
      const { node } = fromDraftIndexed(next, ctx);
      controller.edit(applicableFilter(node, { ...ctx, readable }));
    },
    [ctx, readable, controller],
  );

  const errors = useMemo(() => {
    const { node, idByPath } = fromDraftIndexed(draft, ctx);
    if (!node) return new Map<string, RowErrors>();
    // Missing / mismatched values are "incomplete", not errors: those rows are simply not applied.
    const found = validateFilter(node, ctx.schema, ctx.registry, readable).filter((e) => e.code !== "valueKindMismatch");
    return errorsToRows(found, idByPath);
  }, [draft, ctx, readable]);

  const operatorsForColumnId = useCallback(
    (columnId: string | null) => {
      const column = columnId ? schema.columns.find((c) => c.id === columnId) : undefined;
      return column ? operatorsFor(column, registry) : [];
    },
    [schema, registry],
  );

  const status = toStatus(liveState ?? controller.state, options.error);
  const statusRef = useRef<FilterBuilderStatus | null>(null);
  const onStatusChange = options.onStatusChange;
  useEffect(() => {
    if (statusRef.current && sameStatus(statusRef.current, status)) return;
    statusRef.current = status;
    onStatusChange?.(status);
  });

  return {
    draft,
    errors,
    columns,
    readable,
    maxDepth,
    operatorsForColumnId,
    addCondition: (groupId) => {
      const next = addConditionTo(draftRef.current, groupId);
      const added = findLastCondition(next, groupId);
      setLastAddedId(added);
      commit(next);
    },
    addGroup: (groupId) => {
      const next = addGroupTo(draftRef.current, groupId, maxDepth);
      commit(next);
    },
    remove: (id) => commit(removeNode(draftRef.current, id)),
    updateCondition: (id, patch) => commit(updateCondition(draftRef.current, id, patch, ctx)),
    setGroupOp: (groupId, op) => commit(setGroupOp(draftRef.current, groupId, op)),
    canAddGroup: (groupId) => canAddGroupTo(draft, groupId, maxDepth),
    apply: () => controller.flush(),
    flush: () => controller.flushScheduled(),
    clear: () => {
      const next = toDraft(null);
      draftRef.current = next;
      setDraft(next);
      controller.clear();
    },
    status,
    lastAddedId,
  };
}

function findLastCondition(draft: FilterDraft, groupId: string): string | null {
  const walk = (g: FilterDraft): string | null => {
    if (g.id === groupId) {
      const last = g.children.at(-1);
      return last?.kind === "condition" ? last.id : null;
    }
    for (const c of g.children) {
      if (c.kind === "group") {
        const f = walk(c);
        if (f) return f;
      }
    }
    return null;
  };
  return walk(draft);
}

export interface FilterBuilderProps extends ApplyModeInput {
  schema: GridSchema;
  /** Core field-type registry (operators, validation). */
  registry: FieldTypeRegistry;
  /** UI registry (value `filterComponent`s). */
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  /** The APPLIED filter (controlled). Chips should render this, not the draft. */
  value: FilterNode | null;
  /**
   * Applies a filter (complete conditions only). May return a Promise: while
   * it is pending the FilterButton shows a spinner; a rejection keeps the
   * previous filter and shows the error inline.
   */
  onChange(node: FilterNode | null): unknown;
  /** Maximum group nesting; the root group is depth 1. Default 2. */
  maxDepth?: number;
  dataSource?: DataSource;
  /** Live-mode debounce in ms. Default 300; 0 applies synchronously. */
  debounceMs?: number;
  /** An apply error from the host (e.g. the server rejected the query). Shown inline. */
  error?: string | null;
  /** Reports live/explicit status (pending apply, unapplied changes, error). */
  onStatusChange?(status: FilterBuilderStatus): void;
  /** Focus the first control on mount / when this flips to true (e.g. its popover opened). */
  autoFocus?: boolean;
  /** Injectable timer (tests). */
  timer?: FilterTimer;
}

const numberFormat = new Intl.NumberFormat("en-US");

/** Imperative handle of a FilterBuilder (`ref`). */
export interface FilterBuilderHandle {
  /** Apply the current draft now (explicit Apply). */
  apply(): void;
  /** Live mode: apply a debouncing edit now; call it when the builder is hidden. */
  flush(): void;
  /** Drop every condition and apply `null`. */
  clear(): void;
}

/**
 * Notion/Linear-style AND/OR filter builder over the readable columns of a
 * schema: one line per condition (column · operator · value pills), nested
 * groups on a subtle fill.
 *
 * Applying:
 * - **Live** (default): edits apply automatically, debounced `debounceMs`.
 * - **Explicit**: when `rowCount` exceeds the threshold (`liveFilterThreshold`,
 *   default 5 000 in `mode="server"`, 10 000 in `mode="client"`) or `live={false}`.
 *   Edits stay a local draft; the footer shows "Applies to N rows" with
 *   Clear / "Apply filter", and Enter in any value input applies.
 *
 * Incomplete conditions are never applied. See `useFilterDraft`.
 */
export const FilterBuilder = forwardRef<FilterBuilderHandle, FilterBuilderProps>(function FilterBuilder(props, ref) {
  const { schema, uiRegistry, dataSource, autoFocus, rowCount } = props;
  const api = useFilterDraft(props);
  const apiRef = useRef(api);
  apiRef.current = api;
  useImperativeHandle(
    ref,
    () => ({
      apply: () => apiRef.current.apply(),
      flush: () => apiRef.current.flush(),
      clear: () => apiRef.current.clear(),
    }),
    [],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const explicit = api.status.mode === "explicit";
  const empty = api.draft.children.length === 0;

  const emptyRef = useRef(empty);
  emptyRef.current = empty;
  useEffect(() => {
    if (!autoFocus) return;
    const root = rootRef.current;
    const target = root?.querySelector<HTMLElement>(emptyRef.current ? "[data-sg-add-condition]" : "input[aria-label='Column']");
    target?.focus();
  }, [autoFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.defaultPrevented || e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement;
    if (t.tagName !== "INPUT" || t.getAttribute("aria-expanded") === "true") return;
    // Picker inputs (Column / Operator / relative preset) use Enter to pick an option.
    const label = t.getAttribute("aria-label");
    if (label === "Column" || label === "Operator") return;
    e.preventDefault();
    api.apply();
  };

  const draftCount = countConditions(fromDraftIndexed(api.draft).node);

  return (
    // Enter-to-apply is delegated from the inputs inside.
    <Box ref={rootRef} className="sg-fb" onKeyDown={onKeyDown}>
      <style>{FILTER_BUILDER_CSS}</style>
      <Stack gap={8}>
        {api.status.error ? (
          <Alert
            variant="light"
            color="red"
            radius="md"
            p={8}
            icon={<IconAlertCircle size={16} stroke={1.75} />}
            styles={{ message: { fontSize: 13 }, icon: { marginInlineEnd: 8 } }}
            role="alert"
          >
            {`Filter not applied: ${api.status.error}`}
          </Alert>
        ) : null}

        <FilterGroupEditor group={api.draft} depth={1} api={api} schema={schema} uiRegistry={uiRegistry} dataSource={dataSource} />

        {explicit ? (
          <Group className="sg-fb-footer" justify="space-between" wrap="nowrap" gap="xs">
            <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
              {typeof rowCount === "number" ? `Applies to ${numberFormat.format(rowCount)} rows` : "Changes apply when you press Apply"}
            </Text>
            <Group gap={6} wrap="nowrap">
              <Button size="xs" variant="subtle" color="gray" onClick={api.clear} disabled={empty && draftCount === 0 && !api.status.dirty}>
                Clear
              </Button>
              <Button size="xs" onClick={api.apply} disabled={!api.status.dirty}>
                Apply filter
              </Button>
            </Group>
          </Group>
        ) : null}
      </Stack>
    </Box>
  );
});
