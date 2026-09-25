/**
 * Pure schema edits behind the column panel. Framework-free (copied verbatim by ui-shadcn).
 */
import type { ColumnDef, GridSchema, Option, PermissionUser } from "@ranjeetk25/schema-grid-core";

/** Where a new column goes: an index, or beside a column. */
export type WorkbenchInsertPosition = number | { afterColumnId: string } | { beforeColumnId: string };

/** Inserts `column` at `at` (or the end) and renumbers `order`. */
export function insertColumn(columns: ColumnDef[], column: ColumnDef, at?: WorkbenchInsertPosition | null): ColumnDef[] {
  const sorted = [...columns].sort((a, b) => a.order - b.order);
  let index = sorted.length;
  if (typeof at === "number") index = Math.max(0, Math.min(sorted.length, at));
  else if (at && "afterColumnId" in at) {
    const i = sorted.findIndex((c) => c.id === at.afterColumnId);
    if (i >= 0) index = i + 1;
  } else if (at && "beforeColumnId" in at) {
    const i = sorted.findIndex((c) => c.id === at.beforeColumnId);
    if (i >= 0) index = i;
  }
  sorted.splice(index, 0, column);
  return sorted.map((c, order) => ({ ...c, order }));
}

/** Replaces an existing column or inserts a new one; bumps `schemaVersion`. */
export function upsertColumn(schema: GridSchema, column: ColumnDef, at?: WorkbenchInsertPosition | null): GridSchema {
  const exists = schema.columns.some((c) => c.id === column.id);
  const columns = exists ? schema.columns.map((c) => (c.id === column.id ? column : c)) : insertColumn(schema.columns, column, at);
  return { ...schema, schemaVersion: schema.schemaVersion + 1, columns };
}

export function removeColumn(schema: GridSchema, columnId: string): GridSchema {
  return { ...schema, schemaVersion: schema.schemaVersion + 1, columns: schema.columns.filter((c) => c.id !== columnId) };
}

/** Adds created options to a select-like column's `config.options` (idempotent). */
export function addOptions(schema: GridSchema, columnId: string, added: Pick<Option, "id" | "label">[]): GridSchema {
  let changed = false;
  const columns = schema.columns.map((c) => {
    if (c.id !== columnId) return c;
    const cfg = (c.config ?? {}) as { options?: Pick<Option, "id" | "label">[] };
    const options = cfg.options ?? [];
    const fresh = added.filter((o) => !options.some((x) => x.id === o.id));
    if (fresh.length === 0) return c;
    changed = true;
    return { ...c, config: { ...cfg, options: [...options, ...fresh] } };
  });
  return changed ? { ...schema, schemaVersion: schema.schemaVersion + 1, columns } : schema;
}

/** Roles offered in the column panel: those the schema mentions plus the user's, sorted. */
export function rolesOf(schema: GridSchema, user: PermissionUser): string[] {
  const roles = new Set(user.roles);
  for (const c of schema.columns) {
    for (const rule of [c.permissions?.read, c.permissions?.edit]) {
      if (rule && rule !== "all") for (const r of rule.roles) roles.add(r);
    }
  }
  return [...roles].sort();
}
