import type { ServerContext } from "../context";
import { FilterValidationError, PermissionError, type PermissionUsage } from "../errors";
import {
  type Access,
  type ColumnDef,
  type CoreFilterValidationError,
  type FilterNode,
  type GridQuery,
  type GridSchema,
  dependencies,
  isFormulaError,
  parseFormula,
  readableColumnIds,
  resolveColumnAccess,
  validateFilter,
} from "../internal/core";

export type AccessMap = ReadonlyMap<string, Access>;

/**
 * Row-independent access per column (core `resolveColumnAccess`), plus one
 * server rule: a formula column is hidden when any of its dependencies
 * (transitively) is hidden, so hidden data cannot leak through a formula.
 */
export function resolveAccess(ctx: ServerContext): Map<string, Access> {
  const access = resolveColumnAccess(ctx.schema, ctx.resolver, ctx.user);
  // Fail closed: anything a custom resolver returns other than read/edit is hidden.
  for (const [id, a] of access) if (a !== "read" && a !== "edit") access.set(id, "hidden");
  const byKey = new Map(ctx.schema.columns.map((c) => [c.key, c]));
  const memo = new Map<string, boolean>();
  const leaks = (column: ColumnDef, visiting: Set<string>): boolean => {
    const cached = memo.get(column.id);
    if (cached !== undefined) return cached;
    if (!isReadable(access, column.id)) return true;
    if (column.type !== "formula") return false;
    if (visiting.has(column.id)) return true; // cycles are invalid schemas; fail closed
    visiting.add(column.id);
    const ast = column.formula ? parseFormula(column.formula) : null;
    // Unparseable formulas fail closed (hidden).
    let result = !ast || isFormulaError(ast);
    if (ast && !isFormulaError(ast)) {
      for (const key of dependencies(ast)) {
        const dep = byKey.get(key);
        if (!dep || leaks(dep, visiting)) {
          result = true;
          break;
        }
      }
    }
    visiting.delete(column.id);
    memo.set(column.id, result);
    return result;
  };
  for (const column of ctx.schema.columns) {
    if (column.type === "formula" && leaks(column, new Set())) access.set(column.id, "hidden");
  }
  return access;
}

export function isReadable(access: AccessMap, columnId: string): boolean {
  const a = access.get(columnId);
  return a === "read" || a === "edit";
}

function filterColumnIds(node: FilterNode | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if ("op" in node && "children" in node) {
    for (const c of node.children) filterColumnIds(c, out);
  } else {
    out.push(node.columnId);
  }
  return out;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function assertVisible(ids: string[], usage: PermissionUsage, schema: GridSchema, access: AccessMap): void {
  const known = new Set(schema.columns.map((c) => c.id));
  // Unknown ids are reported by validation (INVALID_FILTER), hidden ones as PERMISSION_DENIED. This
  // distinguishes hidden from missing columns, which is acceptable because clients receive the full schema.
  const hidden = unique(ids.filter((id) => known.has(id) && !isReadable(access, id)));
  if (hidden.length > 0) throw new PermissionError(hidden, usage);
}

function unknownColumnErrors(ids: string[], schema: GridSchema, field: string): CoreFilterValidationError[] {
  const known = new Set(schema.columns.map((c) => c.id));
  const out: CoreFilterValidationError[] = [];
  ids.forEach((id, i) => {
    if (!known.has(id)) out.push({ code: "unknownColumn", path: [i], columnId: id, message: `Unknown column in ${field}` });
  });
  return out;
}

const structural = (message: string): FilterValidationError =>
  new FilterValidationError([{ code: "valueKindMismatch", path: [], message }]);

/** Rejects malformed input with a typed error instead of a TypeError deep in validation. */
function assertWellFormed(query: Pick<GridQuery, "filter" | "sort" | "groupBy">): void {
  const walk = (node: unknown, depth: number): void => {
    if (depth > 16) throw structural("Filter is nested too deeply");
    if (typeof node !== "object" || node === null || Array.isArray(node)) throw structural("Filter node must be an object");
    const n = node as Record<string, unknown>;
    if ("op" in n || "children" in n) {
      if ((n.op !== "and" && n.op !== "or") || !Array.isArray(n.children)) {
        throw structural("Filter group needs op 'and' | 'or' and a children array");
      }
      for (const c of n.children) walk(c, depth + 1);
      return;
    }
    if (typeof n.columnId !== "string" || typeof n.operator !== "string") {
      throw structural("Filter condition needs string columnId and operator");
    }
  };
  if (query.filter !== null && query.filter !== undefined) walk(query.filter, 0);
  if (query.sort !== undefined && !Array.isArray(query.sort)) throw structural("sort must be an array");
  if (query.groupBy !== undefined && !Array.isArray(query.groupBy)) throw structural("groupBy must be an array");
  for (const g of query.groupBy ?? []) {
    if (g.aggregations !== undefined && !Array.isArray(g.aggregations)) throw structural("aggregations must be an array");
  }
}

/**
 * The pinned-group shape produced by `pinGroupFilter`: AND[ conditions…, group ].
 * It may reach depth 3, so the inner group is validated as its own root.
 */
function splitPinnedShape(node: FilterNode | null): { pins: FilterNode[]; inner: FilterNode } | null {
  if (!node || !("op" in node) || node.op !== "and") return null;
  const groups = node.children.filter((c) => "op" in c);
  if (groups.length !== 1 || groups.length === node.children.length) return null;
  const inner = groups[0] as FilterNode;
  return { pins: node.children.filter((c) => !("op" in c)), inner };
}

function validate(filter: FilterNode | null, ctx: ServerContext, readable: ReadonlySet<string>): CoreFilterValidationError[] {
  const errors = validateFilter(filter, ctx.schema, ctx.registry, readable);
  if (!errors.some((e) => e.code === "depthExceeded")) return errors;
  const pinned = splitPinnedShape(filter);
  if (!pinned) return errors;
  const pinIndex = (filter as { children: FilterNode[] }).children;
  const innerErrors = validateFilter(pinned.inner, ctx.schema, ctx.registry, readable).map((e) => ({
    ...e,
    path: [pinIndex.indexOf(pinned.inner), ...e.path],
  }));
  const pinErrors = pinned.pins.flatMap((p) =>
    validateFilter(p, ctx.schema, ctx.registry, readable).map((e) => ({ ...e, path: [pinIndex.indexOf(p), ...e.path] })),
  );
  return [...pinErrors, ...innerErrors];
}

/**
 * Enforces column permissions for everything a query references, BEFORE any
 * SQL is built. Hidden columns in filter / sort / groupBy / aggregations throw
 * `PermissionError` (checked before validation, so the error type is stable).
 * Then core `validateFilter` runs with the readable ids; its errors are wrapped
 * in `FilterValidationError`.
 */
export function assertQueryAccess(
  query: Pick<GridQuery, "filter" | "sort" | "groupBy">,
  ctx: ServerContext,
  access: AccessMap,
): void {
  assertWellFormed(query);
  const schema = ctx.schema;
  const filterIds = filterColumnIds(query.filter);
  const sortIds = (query.sort ?? []).map((s) => s.columnId);
  const groupIds = (query.groupBy ?? []).map((g) => g.columnId);
  const aggIds = (query.groupBy ?? []).flatMap((g) => (g.aggregations ?? []).map((a) => a.columnId));

  assertVisible(filterIds, "filter", schema, access);
  assertVisible(sortIds, "sort", schema, access);
  assertVisible(groupIds, "groupBy", schema, access);
  assertVisible(aggIds, "aggregate", schema, access);

  const readable = readableColumnIds(access);
  const errors = [
    ...validate(query.filter ?? null, ctx, readable),
    ...unknownColumnErrors(sortIds, schema, "sort"),
    ...unknownColumnErrors(groupIds, schema, "groupBy"),
    ...unknownColumnErrors(aggIds, schema, "aggregations"),
  ];
  if (errors.length > 0) throw new FilterValidationError(errors);
}
