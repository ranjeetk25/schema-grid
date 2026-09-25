import { type SQL, sql } from "drizzle-orm";

/** Escape character for LIKE patterns. `!` needs no string escaping and works under NO_BACKSLASH_ESCAPES. */
export const LIKE_ESCAPE_CHAR = "!";

/** Escapes LIKE wildcards (`%`, `_`) and the escape character itself with `!`. */
export function escapeLike(s: string): string {
  return s.replace(/[!%_]/g, (c) => `!${c}`);
}

/** `<expr> [NOT] LIKE ? ESCAPE '!'` — always pair patterns from `escapeLike` with this. */
export function likeSql(expr: SQL, pattern: string, negate = false): SQL {
  return negate
    ? sql`${expr} NOT LIKE ${pattern} ESCAPE '!'`
    : sql`${expr} LIKE ${pattern} ESCAPE '!'`;
}
