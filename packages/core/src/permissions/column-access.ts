import type { GridSchema } from "../schema/types";
import type { Access, PermissionResolver, PermissionUser } from "./types";

/**
 * Column-level access for `user`. A column with `settable: false` is at most
 * "read": the data source cannot write it, whatever the permissions say.
 */
export function resolveColumnAccess(
  schema: GridSchema,
  resolver: PermissionResolver,
  user: PermissionUser,
): Map<string, Access> {
  const access = new Map<string, Access>();
  for (const column of schema.columns) {
    const a = resolver({ user, column });
    access.set(column.id, a === "edit" && column.settable === false ? "read" : a);
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
