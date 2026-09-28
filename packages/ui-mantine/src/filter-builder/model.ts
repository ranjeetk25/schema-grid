/**
 * Pure filter-draft model for the FilterBuilder. No React, no DOM.
 *
 * A draft mirrors the core Filter AST but gives every node a stable client id
 * and allows incomplete conditions (no column / operator yet) while editing.
 * The root of a draft is always a group (depth 1); a group inside the root is
 * depth 2, and so on.
 */
import {
  type ColumnDef,
  type FieldTypeRegistry,
  type FilterCondition,
  type FilterNode,
  type FilterOperatorDef,
  type FilterValue,
  type GridSchema,
  type FilterValueKind,
  getColumnOperators,
  isFilterGroup,
} from "../internal/core-contracts";
import { type AccessMap, readableColumns } from "../internal/access";
import {
  type CellColorCapabilitiesLike,
  type ColorRulesInput,
  canFilterByColor,
  colorFilterBlockedReason,
  columnOperatorsWithColors,
  withColorOperators,
} from "../internal/color-contracts";
import type { FilterScopeCapabilitiesLike } from "../internal/core-contracts";

export interface DraftCondition {
  kind: "condition";
  id: string;
  columnId: string | null;
  operator: string | null;
  value: FilterValue | undefined;
}

export interface DraftGroup {
  kind: "group";
  id: string;
  op: "and" | "or";
  children: DraftNode[];
}

export type DraftNode = DraftGroup | DraftCondition;

/** A filter draft; the root is always a group. */
export type FilterDraft = DraftGroup;

export interface DraftContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  /** v0.4: the source's capabilities; `cellColors.filter` adds "color is" / "has no color". */
  capabilities?: CellColorCapabilitiesLike;
  /** v0.4.1: offer `filterable: false` columns with their own operators (color rule conditions). */
  allowUnfilterable?: boolean;
  /** v0.4.1: the view's color rules; a column one of them blocks gets no color operators. */
  colorRules?: ColorRulesInput;
}

/** v0.4.1 options of `filterableColumns` / `operatorsFor`. */
export interface ColumnPickOptions {
  /**
   * Offer `filterable: false` columns with their own operators. For a color
   * rule's condition: rules render client-side from row values, so any
   * readable column works there.
   */
  allowUnfilterable?: boolean;
  /** The view's color rules: a column one of them blocks (`colorFilterBlockedReason`) gets no color operators. */
  colorRules?: ColorRulesInput;
}

/**
 * v0.4.1: why `column` can't be filtered by color although `capabilities`
 * allow color filtering (a color rule that can color it tests a column the
 * server can't filter on), or null.
 */
export function colorBlockedReason(
  column: ColumnDef,
  capabilities: CellColorCapabilitiesLike | undefined,
  colorRules: ColorRulesInput | undefined,
): string | null {
  if (!colorRules || !canFilterByColor(capabilities)) return null;
  return colorFilterBlockedReason(column, colorRules.rules, colorRules.schema, capabilities as FilterScopeCapabilitiesLike);
}

export type ConditionPatch = Partial<Pick<DraftCondition, "columnId" | "operator" | "value">>;

export const DEFAULT_MAX_DEPTH = 2;

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${++seq}`;

const emptyGroup = (op: "and" | "or" = "and"): DraftGroup => ({ kind: "group", id: nextId("g"), op, children: [] });
const emptyCondition = (): DraftCondition => ({
  kind: "condition",
  id: nextId("c"),
  columnId: null,
  operator: null,
  value: undefined,
});

// ---------------------------------------------------------------------------
// Columns / operators / values
// ---------------------------------------------------------------------------

/**
 * Columns that may appear in a filter picker: readable ones only (fail
 * closed), minus `filterable: false` (v0.2 C1) — unless the source filters by
 * color (v0.4 `capabilities.cellColors.filter`): color operators apply to
 * every readable column, so those columns are offered for color only (v0.4.1:
 * not when a color rule blocks them). `allowUnfilterable` (v0.4.1, color rule
 * conditions) offers every readable column.
 */
export function filterableColumns(
  schema: GridSchema,
  access: AccessMap,
  capabilities?: CellColorCapabilitiesLike,
  options: ColumnPickOptions = {},
): ColumnDef[] {
  const readable = readableColumns(schema, access);
  if (options.allowUnfilterable) return readable;
  if (!canFilterByColor(capabilities)) return readable.filter((c) => c.filterable !== false);
  return readable.filter((c) => c.filterable !== false || colorBlockedReason(c, capabilities, options.colorRules) === null);
}

/**
 * Operators for a column; formula columns use their `config.resultType`'s
 * operators (core `getColumnOperators`). v0.4: with `capabilities.cellColors.filter`
 * "color is" / "has no color" follow (ag-grid's `withColorOperators`), and a
 * `filterable: false` column gets only those (`columnOperatorsWithColors`).
 */
export function operatorsFor(
  column: ColumnDef,
  registry: FieldTypeRegistry,
  capabilities?: CellColorCapabilitiesLike,
  options: ColumnPickOptions = {},
): readonly FilterOperatorDef[] {
  // v0.4.1: a column a color rule blocks gets no color operators.
  const colors = colorBlockedReason(column, capabilities, options.colorRules) === null ? capabilities : undefined;
  if (column.filterable === false && !options.allowUnfilterable && canFilterByColor(capabilities)) {
    return colors ? columnOperatorsWithColors(column, registry, colors) : [];
  }
  return withColorOperators(getColumnOperators(column, registry), colors);
}

/** `operatorsFor` with a draft context's capabilities and v0.4.1 options. */
export function operatorsInContext(column: ColumnDef, ctx: DraftContext): readonly FilterOperatorDef[] {
  return operatorsFor(column, ctx.registry, ctx.capabilities, {
    ...(ctx.allowUnfilterable ? { allowUnfilterable: true } : {}),
    ...(ctx.colorRules ? { colorRules: ctx.colorRules } : {}),
  });
}

export function defaultValueFor(valueKind: FilterValueKind): FilterValue | undefined {
  switch (valueKind) {
    case "none":
      return undefined;
    case "single":
      return null;
    case "multi":
      return [];
    case "range":
      return { from: null, to: null };
    case "relativeDate":
      return { relative: "today" };
    case "me":
      return { me: true };
  }
}

/** Looks up the operator definition of a (column, operator) pair. */
export function findOperator(
  columnId: string | null,
  operatorId: string | null,
  ctx: DraftContext,
): FilterOperatorDef | undefined {
  if (!columnId || !operatorId) return undefined;
  const column = ctx.schema.columns.find((c) => c.id === columnId);
  if (!column) return undefined;
  return operatorsInContext(column, ctx).find((o) => o.id === operatorId);
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function nodeToDraft(node: FilterNode): DraftNode {
  if (isFilterGroup(node)) {
    return { kind: "group", id: nextId("g"), op: node.op, children: node.children.map(nodeToDraft) };
  }
  return {
    kind: "condition",
    id: nextId("c"),
    columnId: node.columnId,
    operator: node.operator,
    value: node.value,
  };
}

/** Core AST → draft. `null` gives an empty AND root; a bare condition is wrapped in an AND root. */
export function toDraft(node: FilterNode | null | undefined): FilterDraft {
  if (!node) return emptyGroup();
  const d = nodeToDraft(node);
  if (d.kind === "group") return d;
  return { ...emptyGroup(), children: [d] };
}

export interface IndexedFilter {
  node: FilterNode | null;
  /** Child-index path (joined with ".", root = "") → draft node id. */
  idByPath: Map<string, string>;
}

/**
 * Draft → core AST plus a path index (for mapping `validateFilter` errors back
 * to draft rows). Incomplete conditions and empty groups are dropped; an empty
 * root gives `null`. Key order is byte-exact to the core AST:
 * `{columnId, operator, value}` (no `value` key for none-kind operators) and
 * `{op, children}`.
 */
export function fromDraftIndexed(draft: FilterDraft, ctx?: DraftContext): IndexedFilter {
  const idByPath = new Map<string, string>();
  const convert = (n: DraftNode, path: number[]): FilterNode | null => {
    if (n.kind === "condition") {
      if (!n.columnId || !n.operator) return null;
      idByPath.set(path.join("."), n.id);
      const kind = ctx ? findOperator(n.columnId, n.operator, ctx)?.valueKind : undefined;
      const cond: FilterCondition = { columnId: n.columnId, operator: n.operator };
      if (kind !== "none" && n.value !== undefined) cond.value = n.value;
      return cond;
    }
    const children: FilterNode[] = [];
    for (const child of n.children) {
      const c = convert(child, [...path, children.length]);
      if (c) children.push(c);
    }
    if (children.length === 0) return null;
    idByPath.set(path.join("."), n.id);
    return { op: n.op, children };
  };
  const node = convert(draft, []);
  return { node, idByPath };
}

/** Draft → core AST (see `fromDraftIndexed`). */
export function fromDraft(draft: FilterDraft, ctx?: DraftContext): FilterNode | null {
  return fromDraftIndexed(draft, ctx).node;
}

/** True when every condition has a column and an operator. */
export function isDraftComplete(draft: DraftNode): boolean {
  if (draft.kind === "condition") return !!draft.columnId && !!draft.operator;
  return draft.children.every(isDraftComplete);
}

export function countConditions(node: FilterNode | DraftNode | null | undefined): number {
  if (!node) return 0;
  if ("kind" in node) return node.kind === "condition" ? 1 : node.children.reduce((n, c) => n + countConditions(c), 0);
  if (isFilterGroup(node)) return node.children.reduce((n, c) => n + countConditions(c), 0);
  return 1;
}

// ---------------------------------------------------------------------------
// Tree edits (immutable; unchanged input is returned by identity on a no-op)
// ---------------------------------------------------------------------------

function mapNode(draft: FilterDraft, id: string, fn: (n: DraftNode) => DraftNode): FilterDraft {
  let changed = false;
  const walk = (n: DraftNode): DraftNode => {
    if (n.id === id) {
      const next = fn(n);
      if (next !== n) changed = true;
      return next;
    }
    if (n.kind === "group") {
      const children = n.children.map(walk);
      return children.some((c, i) => c !== n.children[i]) ? { ...n, children } : n;
    }
    return n;
  };
  const out = walk(draft) as FilterDraft;
  return changed ? out : draft;
}

export function findNode(draft: DraftNode, id: string): DraftNode | undefined {
  if (draft.id === id) return draft;
  if (draft.kind === "group") {
    for (const c of draft.children) {
      const f = findNode(c, id);
      if (f) return f;
    }
  }
  return undefined;
}

/** Depth of a group (root = 1), or undefined if not found. */
export function depthOf(draft: FilterDraft, groupId: string): number | undefined {
  const walk = (n: DraftNode, depth: number): number | undefined => {
    if (n.kind !== "group") return undefined;
    if (n.id === groupId) return depth;
    for (const c of n.children) {
      const d = walk(c, depth + 1);
      if (d !== undefined) return d;
    }
    return undefined;
  };
  return walk(draft, 1);
}

export function canAddGroup(draft: FilterDraft, groupId: string, maxDepth: number = DEFAULT_MAX_DEPTH): boolean {
  const depth = depthOf(draft, groupId);
  return depth !== undefined && depth < maxDepth;
}

export function addCondition(draft: FilterDraft, groupId: string): FilterDraft {
  return mapNode(draft, groupId, (n) => (n.kind === "group" ? { ...n, children: [...n.children, emptyCondition()] } : n));
}

/** Adds an empty nested group; refused (returns `draft`) at or past `maxDepth`. */
export function addGroup(draft: FilterDraft, groupId: string, maxDepth: number = DEFAULT_MAX_DEPTH): FilterDraft {
  if (!canAddGroup(draft, groupId, maxDepth)) return draft;
  return mapNode(draft, groupId, (n) => (n.kind === "group" ? { ...n, children: [...n.children, emptyGroup()] } : n));
}

/** Removes a node. The root cannot be removed. */
export function removeNode(draft: FilterDraft, id: string): FilterDraft {
  if (draft.id === id) return draft;
  const walk = (g: DraftGroup): DraftGroup => {
    const filtered = g.children.filter((c) => c.id !== id);
    const children = filtered.map((c) => (c.kind === "group" ? walk(c) : c));
    const same = children.length === g.children.length && children.every((c, i) => c === g.children[i]);
    return same ? g : { ...g, children };
  };
  return walk(draft);
}

export function setGroupOp(draft: FilterDraft, groupId: string, op: "and" | "or"): FilterDraft {
  return mapNode(draft, groupId, (n) => (n.kind === "group" && n.op !== op ? { ...n, op } : n));
}

/**
 * Patches a condition. A column change resets the operator to the new column's
 * first operator and the value to its default; an operator change resets the
 * value when the valueKind changes. Without `ctx` the resets fall back to
 * `operator: null` / `value: undefined`.
 */
export function updateCondition(draft: FilterDraft, id: string, patch: ConditionPatch, ctx?: DraftContext): FilterDraft {
  return mapNode(draft, id, (n) => {
    if (n.kind !== "condition") return n;
    const next: DraftCondition = { ...n };
    if (patch.columnId !== undefined && patch.columnId !== n.columnId) {
      next.columnId = patch.columnId;
      const column = patch.columnId && ctx ? ctx.schema.columns.find((c) => c.id === patch.columnId) : undefined;
      const first = column && ctx ? operatorsInContext(column, ctx)[0] : undefined;
      next.operator = first?.id ?? null;
      next.value = first ? defaultValueFor(first.valueKind) : undefined;
      return next;
    }
    if (patch.operator !== undefined && patch.operator !== n.operator) {
      const prevKind = ctx ? findOperator(n.columnId, n.operator, ctx)?.valueKind : undefined;
      const nextKind = ctx ? findOperator(n.columnId, patch.operator, ctx)?.valueKind : undefined;
      next.operator = patch.operator;
      if (prevKind !== nextKind || nextKind === undefined) {
        next.value = nextKind ? defaultValueFor(nextKind) : undefined;
      }
    }
    if ("value" in patch) next.value = patch.value;
    return next;
  });
}
