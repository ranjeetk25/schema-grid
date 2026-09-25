import { type SQL, sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import type { FilterValue } from "../internal/core";
import { stringValue } from "./ops-text";
import type { OperatorTranslator } from "./types";

/**
 * A list value (`isAnyOf` / `hasAllOf` …) → string ids. Only arrays of
 * string/number/boolean are accepted; `null` or nested values are rejected.
 */
export function stringListValue(value: FilterValue | undefined, operator: string): string[] {
  if (!Array.isArray(value)) throw new UnsupportedOperatorError(operator, { kind: "expected an array of values" });
  return value.map((v) => {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    throw new UnsupportedOperatorError(operator, { kind: "list values must be strings, numbers or booleans" });
  });
}

/** `{ me: true }` is the only accepted payload; it carries no identity. */
function assertMeValue(value: FilterValue | undefined, operator: string): void {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "me" in value && value.me === true) return;
  throw new UnsupportedOperatorError(operator, { kind: "expected { me: true }" });
}

function inList(expr: SQL, ids: string[], negate: boolean): SQL {
  // Empty IN () is invalid SQL: "any of nothing" matches nothing, "none of nothing" matches everything.
  if (ids.length === 0) return negate ? sql`TRUE` : sql`FALSE`;
  const params = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  return negate ? sql`${expr} NOT IN (${params})` : sql`${expr} IN (${params})`;
}

/** select / creatableSelect (kind "choice") and the shared part of user (kind "ref"). */
export const CHOICE_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  is: ({ expr, value, operator }) => sql`${expr.typed} = ${stringValue(value, operator.id)}`,
  isNot: ({ expr, value, operator }) => sql`${expr.typed} <> ${stringValue(value, operator.id)}`,
  isAnyOf: ({ expr, value, operator }) => inList(expr.typed, stringListValue(value, operator.id), false),
  isNoneOf: ({ expr, value, operator }) => inList(expr.typed, stringListValue(value, operator.id), true),
};

/**
 * user (kind "ref"). `isMe` / `isNotMe` bind `scope.ctx.user.id` — the identity is
 * NEVER read from the filter value, which must be exactly `{ me: true }`.
 */
export const REF_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  ...CHOICE_TRANSLATORS,
  isMe: ({ expr, value, operator, scope }) => {
    assertMeValue(value, operator.id);
    return sql`${expr.typed} = ${scope.ctx.user.id}`;
  },
  isNotMe: ({ expr, value, operator, scope }) => {
    assertMeValue(value, operator.id);
    return sql`${expr.typed} <> ${scope.ctx.user.id}`;
  },
};
