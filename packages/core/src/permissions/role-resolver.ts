import type { RoleRule } from "../schema/types";
import type { Access, PermissionContext, PermissionResolver, PermissionUser } from "./types";

function matchesRule(rule: RoleRule, user: PermissionUser, superRoles: string[]): boolean {
  if (superRoles.some((role) => user.roles.includes(role))) {
    return true;
  }
  if (rule === "all") {
    return true;
  }
  return rule.roles.some((role) => user.roles.includes(role));
}

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

    const canRead = matchesRule(column.permissions.read, user, superRoles);
    if (!canRead) {
      return "hidden";
    }

    const canEdit = !isFormula && matchesRule(column.permissions.edit, user, superRoles);
    return canEdit ? "edit" : "read";
  };
}
