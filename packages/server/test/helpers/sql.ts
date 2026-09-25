import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";

const dialect = new MySqlDialect();

export interface SqlSnapshot {
  sql: string;
  params: unknown[];
}

/** Renders a Drizzle SQL fragment to `{ sql, params }` without a database. */
export function renderSql(fragment: SQL): SqlSnapshot {
  const q = dialect.sqlToQuery(fragment);
  return { sql: q.sql, params: q.params };
}

/** Renders a query builder (anything with `.toSQL()`). */
export function renderQuery(builder: { toSQL(): { sql: string; params: unknown[] } }): SqlSnapshot {
  const q = builder.toSQL();
  return { sql: q.sql, params: q.params };
}

export function mockDb() {
  return drizzle.mock();
}
