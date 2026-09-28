import { matchesRoleRule } from "./match-role-rule";
import type { Access, PermissionContext, PermissionResolver } from "./types";

export interface RolePermissionResolverOptions {
  superRoles?: string[];
}

/**
 * Default PermissionResolver: derives access from `ColumnDef.permissions`.
 * A missing permissions object means edit for everyone. Formula columns are
 * always capped at read.
 */
export function createRolePermissionResolver(
  options: RolePermissionResolverOptions = {},
): PermissionResolver {
  const superRoles = options.superRoles ?? [];

  return (ctx: PermissionContext): Access => {
    const { column, user } = ctx;
    const isFormula = column.type === "formula";

    if (!column.permissions) {
      return isFormula ? "read" : "edit";
    }

    const canRead = matchesRoleRule(column.permissions.read, user, superRoles);
    if (!canRead) {
      return "hidden";
    }

    const canEdit = !isFormula && matchesRoleRule(column.permissions.edit, user, superRoles);
    return canEdit ? "edit" : "read";
  };
}
