import { dependencies } from "../formula/dependencies";
import { parseFormula } from "../formula/parser";
import { isFormulaError } from "../formula/types";
import type { FieldTypeRegistry } from "../field-types/registry";
import { resolveColumnAccess } from "../permissions/column-access";
import type { Access, PermissionResolver, PermissionUser } from "../permissions/types";
import { getColumnById, getColumnByKey } from "../schema/lookup";
import type { ColumnDef, GridSchema } from "../schema/types";
import { InMemoryQueryError } from "./types";

export interface MemoryQueryContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: ReadonlyMap<string, Access>;
  now: Date;
  tz: string;
  userId?: string;
}

export function readableColumns(ctx: MemoryQueryContext): ColumnDef[] {
  return ctx.schema.columns.filter((c) => {
    const a = ctx.access.get(c.id);
    return a === "read" || a === "edit";
  });
}

/** Resolves a column id that must exist and be readable, or throws InMemoryQueryError. */
export function requireReadableColumn(
  columnId: string,
  ctx: MemoryQueryContext,
  what: string,
): ColumnDef {
  const column = getColumnById(ctx.schema, columnId);
  if (!column) {
    throw new InMemoryQueryError("unknownColumn", `Cannot ${what} by an unknown column`);
  }
  const a = ctx.access.get(column.id);
  if (a !== "read" && a !== "edit") {
    throw new InMemoryQueryError("unreadableColumn", `Cannot ${what} by a column you cannot read`);
  }
  return column;
}


/**
 * Column access for the in-memory source: the resolver's answer, except that a
 * formula column depending (transitively) on a column the user cannot read is
 * hidden too, so formulas never reveal hidden data. Without a user, everything
 * except `settable: false` columns is editable (formulas stay read-only via the mutation rules).
 */
export function resolveMemoryAccess(
  schema: GridSchema,
  resolver: PermissionResolver,
  user: PermissionUser | undefined,
): Map<string, Access> {
  if (!user) return new Map(schema.columns.map((c) => [c.id, (c.settable === false ? "read" : "edit") as Access]));
  const access = resolveColumnAccess(schema, resolver, user);
  const leaks = (column: ColumnDef, seen: Set<string>): boolean => {
    if (seen.has(column.key)) return false;
    seen.add(column.key);
    const ast = typeof column.formula === "string" ? parseFormula(column.formula) : null;
    if (!ast || isFormulaError(ast)) return false;
    for (const key of dependencies(ast)) {
      const dep = getColumnByKey(schema, key);
      if (!dep) continue;
      if (access.get(dep.id) === "hidden") return true;
      if (dep.type === "formula" && leaks(dep, seen)) return true;
    }
    return false;
  };
  for (const column of schema.columns) {
    if (column.type === "formula" && access.get(column.id) !== "hidden" && leaks(column, new Set())) {
      access.set(column.id, "hidden");
    }
  }
  return access;
}
