import type { RoleRule } from "../common/types";
import type { PermissionUser } from "./types";

/**
 * The one `RoleRule` matcher (column permissions, `Option.settableBy`): true
 * when `user` holds a `superRoles` role, the rule is `"all"`, any of their
 * roles is in `roles`, or their `id` is in `users` (v0.4). `{}` or empty
 * lists match nobody.
 */
export function matchesRoleRule(rule: RoleRule, user: PermissionUser, superRoles: readonly string[] = []): boolean {
  if (superRoles.some((role) => user.roles.includes(role))) return true;
  if (rule === "all") return true;
  if (rule.roles?.some((role) => user.roles.includes(role))) return true;
  return rule.users?.includes(user.id) ?? false;
}
