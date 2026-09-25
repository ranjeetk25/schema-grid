import { type SQL, sql } from "drizzle-orm";
import type { GridRow } from "../internal/core";
import { ident } from "../sql/column-expr";
import type { SqlScope } from "../sql/scope";
import type { StorageKind } from "../sql/storage-kind";
import { storageKindOf } from "../sql/storage-kind";
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

function normalizeCellValue(raw: unknown, kind: StorageKind, subPath: string | undefined): CursorKeyValue {
  if (raw === null || raw === undefined || raw === "") return null;
  if (Array.isArray(raw) && raw.length === 0) return null;

  if (subPath === "id" && raw !== null && typeof raw === "object") {
    const id = (raw as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }

  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  return null;
}

/** Builds the next keyset cursor payload from the last row of a page. */
export function cursorFromRow(row: GridRow, keys: readonly SortKey[], scope: SqlScope, fp: string): CursorPayload {
  const values = keys.map((key) => {
    const column = scope.ctx.schema.columns.find((c) => c.id === key.columnId);
    if (!column) return null;
    const info = storageKindOf(column, scope.ctx.registry, scope.storageOverrides);
    return normalizeCellValue(row.cells[column.key], info.kind, info.subPath);
  });
  return { v: 1, mode: "keyset", fp, keys: values, id: row.id };
}
