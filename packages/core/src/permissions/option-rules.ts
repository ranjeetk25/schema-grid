/**
 * Per-option write rules (v0.3): `Option.settableBy` restricts WHO may set a
 * select / multiSelect / creatableSelect option. Existing values stay readable
 * and renderable; only a change that INTRODUCES a restricted option id is
 * rejected. Without a user (no-user data sources) everything is settable.
 */
import type { Option } from "../common/types";
import { safeOptions } from "../field-types/builtins/options-shared";
import type { ColumnDef } from "../schema/types";
import type { PermissionUser } from "./types";

/** Column types whose config carries `options` with `settableBy` rules. */
export const OPTION_COLUMN_TYPES: ReadonlySet<string> = new Set(["select", "multiSelect", "creatableSelect"]);

/** True when `user` may set `option` (`settableBy` absent or `"all"` = everyone). */
export function canSetOption(option: Option, user: PermissionUser | undefined): boolean {
  const rule = option.settableBy;
  if (!user || rule === undefined || rule === "all") return true;
  return rule.roles.some((role) => user.roles.includes(role));
}

/** The options of an option-typed column (all of them), `[]` for other types. */
export function columnOptions(column: ColumnDef): Option[] {
  if (!OPTION_COLUMN_TYPES.has(column.type)) return [];
  return safeOptions((column.config as { options?: unknown } | null)?.options);
}

/** The options `user` may set on `column`, in config order. */
export function resolveSettableOptions(column: ColumnDef, user: PermissionUser | undefined): Option[] {
  return columnOptions(column).filter((o) => canSetOption(o, user));
}

/** "counsellor" → "Counsellor", "finance_team" → "Finance team". */
function roleLabel(role: string): string {
  const words = role.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `Option “Verified” can only be set by Admin` (roles joined with "or"). */
export function optionNotSettableMessage(option: Option): string {
  const roles = option.settableBy && option.settableBy !== "all" ? option.settableBy.roles.map(roleLabel) : [];
  const who =
    roles.length === 0
      ? "nobody"
      : roles.length === 1
        ? roles[0]
        : `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}`;
  return `Option “${option.label}” can only be set by ${who}`;
}

const idsOf = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * The rejection message when `next` introduces an option `user` cannot set
 * (ids already present in `prev` are never re-checked), else `null`. Unknown
 * ids are left to the field type's value schema.
 */
export function optionRuleViolation(
  column: ColumnDef,
  next: unknown,
  user: PermissionUser | undefined,
  ctx: { prev?: unknown } = {},
): string | null {
  if (!user) return null;
  const options = columnOptions(column);
  if (options.length === 0) return null;
  const existing = new Set(idsOf(ctx.prev));
  for (const id of idsOf(next)) {
    if (existing.has(id)) continue;
    const option = options.find((o) => o.id === id);
    if (option && !canSetOption(option, user)) return optionNotSettableMessage(option);
  }
  return null;
}
