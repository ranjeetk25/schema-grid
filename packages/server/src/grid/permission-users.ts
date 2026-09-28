/**
 * Per-person `RoleRule.users` lists in a schema (v0.4): column
 * `permissions.read` / `permissions.edit` and option `settableBy`. `getSchema`
 * redacts them for callers without schema write; `updateSchema` dedupes them.
 */
import type { ColumnDef, GridSchema, PermissionUser, RoleRule } from "../internal/core";

type RuleMap = (rule: RoleRule) => RoleRule;

function mapOptions(config: unknown, fn: RuleMap): unknown {
  const options = (config as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return config;
  let changed = false;
  const next = options.map((o: unknown) => {
    const rule = (o as { settableBy?: RoleRule } | null)?.settableBy;
    if (!rule || rule === "all" || rule.users === undefined) return o;
    changed = true;
    return { ...(o as object), settableBy: fn(rule) };
  });
  return changed ? { ...(config as object), options: next } : config;
}

/** `schema` with `fn` applied to every rule carrying a `users` list (copy-on-write). */
function mapUserRules(schema: GridSchema, fn: RuleMap): GridSchema {
  const apply = (rule: RoleRule) => (rule !== "all" && rule.users !== undefined ? fn(rule) : rule);
  const columns = schema.columns.map((column): ColumnDef => {
    const permissions = column.permissions ? { read: apply(column.permissions.read), edit: apply(column.permissions.edit) } : undefined;
    const config = mapOptions(column.config, fn);
    const same = config === column.config && (!permissions || (permissions.read === column.permissions?.read && permissions.edit === column.permissions?.edit));
    return same ? column : { ...column, config, ...(permissions ? { permissions } : {}) };
  });
  return { ...schema, columns };
}

/** True when any column permission or option `settableBy` lists users. */
export function hasPermissionUsers(schema: GridSchema): boolean {
  let found = false;
  mapUserRules(schema, (rule) => {
    found = true;
    return rule;
  });
  return found;
}

/**
 * Replaces every `users` list with `[user.id]` when the caller is listed,
 * else `[]`: the client resolver still computes the caller's own access, and
 * nobody else's id is disclosed. No user → every list is emptied.
 */
export function redactPermissionUsers(schema: GridSchema, user: PermissionUser | undefined): GridSchema {
  return mapUserRules(schema, (rule) => {
    const { users = [], ...rest } = rule as Exclude<RoleRule, "all">;
    return { ...rest, users: user && users.includes(user.id) ? [user.id] : [] };
  });
}

/** Drops repeated ids from every `users` list (first wins). */
export function dedupePermissionUsers(schema: GridSchema): GridSchema {
  return mapUserRules(schema, (rule) => {
    const r = rule as Exclude<RoleRule, "all">;
    return { ...r, users: [...new Set(r.users)] };
  });
}

/** `ctx.user` when it is shaped like a `PermissionUser` (`{ id: string, roles: string[] }`). */
export function userFromContext(ctx: unknown): PermissionUser | undefined {
  const user = (ctx as { user?: unknown } | null | undefined)?.user as Partial<PermissionUser> | undefined;
  return user && typeof user.id === "string" && Array.isArray(user.roles) ? (user as PermissionUser) : undefined;
}
