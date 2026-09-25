import type { GridSchema } from "../schema/types";
import type { Access, PermissionResolver, PermissionUser } from "./types";

export function resolveColumnAccess(
  schema: GridSchema,
  resolver: PermissionResolver,
  user: PermissionUser,
): Map<string, Access> {
  const access = new Map<string, Access>();
  for (const column of schema.columns) {
    access.set(column.id, resolver({ user, column }));
  }
  return access;
}

export function readableColumnIds(accessMap: ReadonlyMap<string, Access>): Set<string> {
  const ids = new Set<string>();
  for (const [id, access] of accessMap) {
    if (access === "read" || access === "edit") {
      ids.add(id);
    }
  }
  return ids;
}

export function editableColumnIds(accessMap: ReadonlyMap<string, Access>): Set<string> {
  const ids = new Set<string>();
  for (const [id, access] of accessMap) {
    if (access === "edit") {
      ids.add(id);
    }
  }
  return ids;
}
