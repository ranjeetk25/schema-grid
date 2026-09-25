import { drizzle } from "drizzle-orm/mysql2";

export interface FakeCall {
  sql: string;
  params: unknown[];
  /** true for drizzle selects (rows must be returned as arrays in select-field order). */
  rowsAsArray: boolean;
}

export type FakeResult = unknown[][] | { affectedRows?: number; insertId?: number } | undefined;
export type FakeResponder = (call: FakeCall) => FakeResult;

/**
 * A real drizzle `MySql2Database` over a scripted fake mysql2 client, so unit
 * tests exercise real builders, transactions and result mapping without a DB.
 * Selects must answer with arrays in select-field order (see `asRows`).
 */
export function createFakeMysql(responder: FakeResponder = () => undefined) {
  const calls: FakeCall[] = [];
  const handle = async (opts: string | { sql: string; values?: unknown[]; rowsAsArray?: boolean }, params?: unknown[]) => {
    const call: FakeCall = {
      sql: typeof opts === "string" ? opts : opts.sql,
      params: params ?? (typeof opts === "string" ? [] : (opts.values ?? [])),
      rowsAsArray: typeof opts === "string" ? false : opts.rowsAsArray === true,
    };
    calls.push(call);
    const r = responder(call);
    if (Array.isArray(r)) return [r, []];
    return [{ affectedRows: r?.affectedRows ?? 0, insertId: r?.insertId ?? 0 }, undefined];
  };
  const client = { query: handle, execute: handle };
  const db = drizzle(client as never);
  /** Calls excluding transaction control statements. */
  const statements = () => calls.filter((c) => !/^(begin|commit|rollback)$/i.test(c.sql.trim()));
  return { db, calls, statements };
}

/** Converts objects to row arrays in the given field order (drizzle `rowsAsArray`). */
export function asRows(objects: Record<string, unknown>[], order: string[]): unknown[][] {
  return objects.map((o) => order.map((k) => o[k]));
}
