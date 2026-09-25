/** TEMPORARY copy of core's role resolver + column access (core plan Task 6). TODO(core) */
import type { Access, GridSchema, PermissionResolver, PermissionUser, RoleRule } from "./types";

function passes(rule: RoleRule | undefined, roles: string[]): boolean {
  if (rule === undefined || rule === "all") return true;
  return rule.roles.some((r) => roles.includes(r));
}

export function createRolePermissionResolver(options?: { superRoles?: string[] }): PermissionResolver {
  const superRoles = options?.superRoles ?? [];
  return ({ user, column }) => {
    const isSuper = user.roles.some((r) => superRoles.includes(r));
    let access: Access;
    if (isSuper) access = "edit";
    else if (!column.permissions) access = "edit";
    else if (!passes(column.permissions.read, user.roles)) access = "hidden";
    else access = passes(column.permissions.edit, user.roles) ? "edit" : "read";
    if (column.type === "formula" && access === "edit") access = "read";
    return access;
  };
}

export function resolveColumnAccess(
  schema: GridSchema,
  resolver: PermissionResolver,
  user: PermissionUser,
): Map<string, Access> {
  const out = new Map<string, Access>();
  for (const column of schema.columns) out.set(column.id, resolver({ user, column }));
  return out;
}

export function readableColumnIds(access: ReadonlyMap<string, Access>): Set<string> {
  const out = new Set<string>();
  for (const [id, a] of access) if (a !== "hidden") out.add(id);
  return out;
}

export function editableColumnIds(access: ReadonlyMap<string, Access>): Set<string> {
  const out = new Set<string>();
  for (const [id, a] of access) if (a === "edit") out.add(id);
  return out;
}
