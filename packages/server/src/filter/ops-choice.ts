import { type SQL, sql } from "drizzle-orm";
import { UnsupportedOperatorError } from "../errors";
import type { FilterValue } from "../internal/core";
import type { OperatorTranslator } from "./types";
import { assertUsableIdList, idListValue, idValue, isEmptyIdList } from "./values";

/**
 * `{ me: true }` is the only accepted payload; it carries no identity. core's
 * matcher ignores the value of `isMe`, but core's `validateFilter` requires
 * exactly `{ me: true }`, so a malformed payload stays a hard error here.
 */
function assertMeValue(value: FilterValue | undefined, operator: string): void {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "me" in value && value.me === true) return;
  throw new UnsupportedOperatorError(operator, { kind: "expected { me: true }" });
}

function inList(expr: SQL, ids: string[], negate: boolean): SQL {
  // Empty IN () is invalid SQL; callers only pass [] for the positive form ("any of nothing")
  // — `isNoneOf []` short-circuits to TRUE before reaching here.
  if (ids.length === 0) return sql`FALSE`;
  const params = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  return negate ? sql`${expr} NOT IN (${params})` : sql`${expr} IN (${params})`;
}

/**
 * select / creatableSelect (kind "choice") and the shared part of user (kind "ref").
 * Ids compare as strings (core `idOf` / `asIdList`): numbers bind as strings,
 * `{ id }` objects are accepted for `is`. `isAnyOf` with no ids is FALSE;
 * `isNoneOf []` is vacuously TRUE (every row, empty cells included); a non-empty
 * `isNoneOf` list without a usable id is unusable (FALSE → only empty cells).
 */
export const CHOICE_TRANSLATORS: Readonly<Record<string, OperatorTranslator>> = {
  is: ({ expr, value }) => sql`${expr.typed} = ${idValue(value)}`,
  isNot: ({ expr, value }) => sql`${expr.typed} <> ${idValue(value)}`,
  isAnyOf: ({ expr, value }) => inList(expr.typed, idListValue(value), false),
  isNoneOf: ({ expr, value }) => {
    if (isEmptyIdList(value)) return sql`TRUE`;
    assertUsableIdList(value);
    return inList(expr.typed, idListValue(value), true);
  },
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
