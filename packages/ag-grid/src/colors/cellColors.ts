/**
 * v0.4 cell colors, grid side: the resolver behind the color classes, rule
 * sanitising / pruning, and the pure cell / row class rules.
 *
 * - `createCellColorResolver` answers "which color does this cell / row
 *   show?" with core's `resolveCellColor` / `resolveRowColor` (manual > first
 *   matching `cells` rule > first matching `row` rule). Rules are evaluated
 *   on computed formula values (`getCellValue`), like client filters. Answers
 *   are memoised per ROW OBJECT: the row store replaces a row's object
 *   whenever its version, cells or colors change, so identity covers "row
 *   version + colors"; a new resolver is built whenever the rules (or the
 *   schema, user, capabilities…) change, which covers "rules identity".
 * - `sanitizeColorRules` keeps the rules that are valid for the current
 *   user (`validateColorRules` rule by rule): a rule that reads or targets a
 *   hidden column is dropped, so a color can never leak a hidden value.
 * - `pruneColorRules` drops unknown columns (schema deletion / applying a
 *   view): `cells` targets lose them (a rule left without targets is
 *   removed) and `when` loses the conditions on them (like view filters).
 * - Class rules read `params.context.cellColors` (the grid's resolver), so
 *   they stay pure functions of `params`.
 */
import type { CellClassParams, CellClassRules, RowClassParams, RowClassRules } from "ag-grid-community";
import {
  CELL_COLORS,
  type CellColor,
  type ColorRule,
  type ColumnDef,
  type FieldTypeRegistry,
  type FilterMatchContext,
  type FilterNode,
  type GridRow,
  type GridSchema,
  DEFAULT_TIME_ZONE,
  isFilterGroup,
  resolveCellColor,
  resolveRowColor,
  validateColorRules,
} from "../internal/core";
import { cellColorClass, SG_CLASSES } from "../theme/classNames";

export interface CellColorResolverOptions {
  /** The active view's rules, already sanitised for the user (`sanitizeColorRules`). */
  rules: readonly ColorRule[];
  schema: GridSchema;
  registry: FieldTypeRegistry;
  user?: { id: string };
  tz?: string;
  /** Default: the resolver's creation time (relative dates in rules). */
  now?: Date;
  /** Computed formula values (rules on formula columns). */
  getCellValue?(row: GridRow, column: ColumnDef): unknown;
  /**
   * Manual colors (`GridRow.colors`) count. False when the source's
   * `capabilities.cellColors.read` is false: rule colors only. Default true.
   */
  manual?: boolean;
}

export interface CellColorResolver {
  readonly rules: readonly ColorRule[];
  /** True when some enabled rule targets the whole row. */
  readonly hasRowRules: boolean;
  /** The color the cell shows, or null. */
  cellColor(row: GridRow, columnId: string): CellColor | null;
  /** The row-rule color of the row (its background), or null. */
  rowColor(row: GridRow): CellColor | null;
}

interface RowMemo {
  /** The row as rules see it (formula cells materialised, manual colors dropped when disabled). */
  target: GridRow;
  cells: Map<string, CellColor | null>;
  row?: CellColor | null;
}

function hasOwnColors(row: GridRow): boolean {
  const colors = row.colors;
  return typeof colors === "object" && colors !== null && Object.keys(colors).length > 0;
}

export function createCellColorResolver(options: CellColorResolverOptions): CellColorResolver {
  const { rules, schema, getCellValue } = options;
  const manual = options.manual !== false;
  const active = rules.filter((r) => r.enabled !== false);
  const hasRules = active.length > 0;
  const hasRowRules = active.some((r) => r.target.kind === "row");
  const formulaColumns = schema.columns.filter((c) => c.type === "formula");
  const ctx: FilterMatchContext = {
    schema,
    registry: options.registry,
    now: options.now ?? new Date(),
    tz: options.tz ?? DEFAULT_TIME_ZONE,
    ...(options.user ? { userId: options.user.id } : {}),
  };
  const memo = new WeakMap<GridRow, RowMemo>();

  const memoFor = (row: GridRow): RowMemo => {
    let entry = memo.get(row);
    if (entry) return entry;
    let target = row;
    if (getCellValue && formulaColumns.length > 0 && hasRules) {
      const cells = { ...row.cells };
      for (const c of formulaColumns) cells[c.key] = getCellValue(row, c);
      target = { ...target, cells };
    }
    if (!manual && row.colors !== undefined) {
      const { colors: _dropped, ...rest } = target;
      target = rest as GridRow;
    }
    entry = { target, cells: new Map() };
    memo.set(row, entry);
    return entry;
  };

  return {
    rules,
    hasRowRules,
    cellColor(row, columnId) {
      if (!row || typeof row !== "object") return null;
      // Fast path: nothing could color this cell.
      if (!hasRules && (!manual || !hasOwnColors(row))) return null;
      const entry = memoFor(row);
      const cached = entry.cells.get(columnId);
      if (cached !== undefined) return cached;
      const color = resolveCellColor(entry.target, columnId, active, ctx);
      entry.cells.set(columnId, color);
      return color;
    },
    rowColor(row) {
      if (!row || typeof row !== "object" || !hasRowRules) return null;
      const entry = memoFor(row);
      if (entry.row === undefined) entry.row = resolveRowColor(entry.target, active, ctx);
      return entry.row;
    },
  };
}

/**
 * The rules usable for this user, in order: each rule is validated on its
 * own (`validateColorRules`) and dropped when invalid (unknown color, hidden
 * or unknown column in its target or `when`, color operators in `when`…).
 * Returns the input array itself when every rule is valid.
 */
export function sanitizeColorRules(
  rules: readonly ColorRule[] | undefined,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readableColumnIds: ReadonlySet<string>,
): readonly ColorRule[] {
  if (!rules || rules.length === 0) return EMPTY_RULES;
  const kept = rules.filter((rule) => validateColorRules([rule], schema, registry, readableColumnIds).ok);
  return kept.length === rules.length ? rules : kept;
}

const EMPTY_RULES: readonly ColorRule[] = Object.freeze([]);

function pruneWhen(node: FilterNode | null, isKnown: (columnId: string) => boolean): FilterNode | null {
  if (!node) return null;
  if (isFilterGroup(node)) {
    const children = node.children.map((c) => pruneWhen(c, isKnown)).filter((c): c is FilterNode => c !== null);
    if (children.length === 0) return null;
    return children.length === node.children.length && children.every((c, i) => c === node.children[i])
      ? node
      : { op: node.op, children };
  }
  return isKnown(node.columnId) ? node : null;
}

/**
 * Drops unknown columns from the rules: `cells` targets lose them (a rule
 * with no target left is removed) and `when` loses the conditions on them.
 * Returns the input array itself when nothing changed.
 */
export function pruneColorRules(rules: readonly ColorRule[], isKnown: (columnId: string) => boolean): ColorRule[] {
  let changed = false;
  const out: ColorRule[] = [];
  for (const rule of rules) {
    let next = rule;
    if (rule.target.kind === "cells") {
      const columnIds = rule.target.columnIds.filter(isKnown);
      if (columnIds.length === 0) {
        changed = true;
        continue;
      }
      if (columnIds.length !== rule.target.columnIds.length) next = { ...next, target: { kind: "cells", columnIds } };
    }
    const when = pruneWhen(rule.when, isKnown);
    if (when !== rule.when) next = { ...next, when };
    if (next !== rule) changed = true;
    out.push(next);
  }
  return changed ? out : (rules as ColorRule[]);
}

// ---- Class rules ------------------------------------------------------------------------

function resolverOf(context: unknown): CellColorResolver | undefined {
  if (!context || typeof context !== "object") return undefined;
  const r = (context as { cellColors?: unknown }).cellColors;
  return r && typeof r === "object" && typeof (r as CellColorResolver).cellColor === "function"
    ? (r as CellColorResolver)
    : undefined;
}

/** A plain data row (group / load-more display rows have no `cells`). */
function dataRowOf(data: unknown): GridRow | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Partial<GridRow> & { __sg?: unknown };
  if (d.__sg !== undefined || typeof d.id !== "string" || !d.cells || typeof d.cells !== "object") return undefined;
  return d as GridRow;
}

function cellColorOf<Row extends GridRow>(p: CellClassParams<Row>): CellColor | null {
  const resolver = resolverOf(p.context);
  const row = dataRowOf(p.data);
  const colId = p.colDef?.colId;
  if (!resolver || !row || colId === undefined) return null;
  return resolver.cellColor(row, colId);
}

function rowColorOf<Row extends GridRow>(p: RowClassParams<Row>): CellColor | null {
  const resolver = resolverOf(p.context);
  const row = dataRowOf(p.data);
  if (!resolver || !row) return null;
  return resolver.rowColor(row);
}

/** `sg-cell-colored` + one `sg-color-<name>` per palette color, from `context.cellColors`. */
export function createCellColorClassRules<Row extends GridRow = GridRow>(): CellClassRules<Row> {
  const rules: CellClassRules<Row> = {
    [SG_CLASSES.cellColored]: (p: CellClassParams<Row>) => cellColorOf(p) !== null,
  };
  for (const color of CELL_COLORS) rules[cellColorClass(color)] = (p: CellClassParams<Row>) => cellColorOf(p) === color;
  return rules;
}

/** `sg-row-colored` + one `sg-color-<name>` per palette color, for rows colored by a `row` rule. */
export function createRowColorClassRules<Row extends GridRow = GridRow>(): RowClassRules<Row> {
  const rules: RowClassRules<Row> = {
    [SG_CLASSES.rowColored]: (p: RowClassParams<Row>) => rowColorOf(p) !== null,
  };
  for (const color of CELL_COLORS) rules[cellColorClass(color)] = (p: RowClassParams<Row>) => rowColorOf(p) === color;
  return rules;
}

export { cellColorClass };
