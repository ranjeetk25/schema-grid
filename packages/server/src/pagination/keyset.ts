import { type SQL, sql } from "drizzle-orm";
import { ident } from "../sql/column-expr";
import type { StorageKind } from "../sql/storage-kind";
import type { SortKey } from "../sort/translate-sort";
import type { CursorPayload } from "./cursor";

export type CursorKeyValue = string | number | boolean | null;

export interface KeysetCursor {
  keys: CursorKeyValue[];
  id: string;
}

/** MySQL binds a bound ISO datetime string against `DATETIME(3)` fine only in this normalized shape. */
function toDatetimeLiteral(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

function bindValue(kind: StorageKind, value: CursorKeyValue): CursorKeyValue {
  if (value === null) return null;
  if (kind === "datetime" && typeof value === "string") return toDatetimeLiteral(value);
  return value;
}

/**
 * Expands `(sort cols..., id)` into an OR chain: no row-constructor tuples, because
 * directions can mix ASC/DESC. Nulls sort last in both directions, per T11:
 * - cursor value null on key i → equal_i is `nullFlag_i = 1`; nothing sorts strictly
 *   after a null in this key, so no "after" branch is added for it.
 * - cursor value non-null on key i → after_i is `(nullFlag_i = 1 OR expr_i <cmp> ?)`
 *   (nulls always come after a non-null value in both directions), equal_i is
 *   `(nullFlag_i = 0 AND expr_i = ?)`.
 * Branches: for each key i with a defined after_i, AND(equal_0..equal_{i-1}, after_i);
 * plus a final branch AND(all equal_i), `id > ?`.
 */
export function keysetPredicate(keys: readonly SortKey[], cursor: KeysetCursor): SQL {
  const equalParts: SQL[] = [];
  const branches: SQL[] = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const raw = cursor.keys[i] ?? null;
    const bound = bindValue(key.kind, raw);

    if (raw === null) {
      equalParts.push(sql`${key.nullFlag} = 1`);
      continue;
    }

    const after =
      key.dir === "asc" ? sql`(${key.nullFlag} = 1 OR ${key.expr} > ${bound})` : sql`(${key.nullFlag} = 1 OR ${key.expr} < ${bound})`;
    branches.push(sql`(${sql.join([...equalParts, after], sql` AND `)})`);
    equalParts.push(sql`(${key.nullFlag} = 0 AND ${key.expr} = ${bound})`);
  }

  const idBranch = sql`(${sql.join([...equalParts, sql`${ident("id")} > ${cursor.id}`], sql` AND `)})`;
  branches.push(idBranch);

  return sql`(${sql.join(branches, sql` OR `)})`;
}

/** Select-map aliases carrying each sort key's SQL value / empty flag (see `sortKeySelect`). */
export const sortValueAlias = (i: number) => `__sk${i}`;
export const sortNullAlias = (i: number) => `__sn${i}`;

/** Extra select fields so the next cursor is built from the exact SQL sort values, not JS values. */
export function sortKeySelect(keys: readonly SortKey[]): Record<string, SQL> {
  const out: Record<string, SQL> = {};
  keys.forEach((k, i) => {
    out[sortValueAlias(i)] = k.expr;
    out[sortNullAlias(i)] = k.nullFlag;
  });
  return out;
}

function rawKeyValue(v: unknown): CursorKeyValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.toISOString();
  // DECIMAL/bigint come back as strings from mysql2; anything else is stringified for an exact re-bind.
  return String(v);
}

/** Next keyset cursor from the last DB row of a page, using the `sortKeySelect` values. */
export function cursorFromDbRow(
  dbRow: Record<string, unknown>,
  keys: readonly SortKey[],
  fp: string,
): CursorPayload {
  const values = keys.map((_, i) => (Number(dbRow[sortNullAlias(i)]) === 1 ? null : rawKeyValue(dbRow[sortValueAlias(i)])));
  return { v: 1, mode: "keyset", fp, keys: values, id: String(dbRow.id) };
}
