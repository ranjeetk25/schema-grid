import {
  type ColumnDef,
  type GridSchema,
  type RowPartial,
  createRolePermissionResolver,
} from "@masai/schema-grid-core";
import { createDefaultRegistry } from "@masai/schema-grid-core/field-types";
import {
  createFixtureRows,
  createFixtureSchema,
} from "@masai/schema-grid-core/testing";
import { createServerContext } from "@masai/schema-grid-server";
import {
  createChangeLogTableDDL,
  createRowsTableDDL,
  diffIndexedColumns,
  formulaSqlHook,
} from "@masai/schema-grid-server/ddl";
import {
  type GridDb,
  type GridTables,
  createRows,
} from "@masai/schema-grid-server/drizzle";
import { rawQuery } from "./db";
import type { SchemaStore } from "./schema-store";

export interface GridEnv {
  db: GridDb;
  tables: GridTables;
  gridId: string;
  tz: string;
}

const SEED_USER = { id: "seed", roles: ["seed"] };

function seedContext(schema: GridSchema, env: GridEnv, now: Date) {
  return createServerContext({
    schema,
    registry: createDefaultRegistry(),
    resolver: createRolePermissionResolver({ superRoles: ["seed"] }),
    user: SEED_USER,
    tz: env.tz,
    now: () => now,
  });
}

async function existingTables(
  db: GridDb,
  names: string[],
): Promise<Set<string>> {
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const rows = await rawQuery<{ name: string }>(
    db,
    `SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${list})`,
  );
  return new Set(rows.map((r) => r.name));
}

async function existingGeneratedColumns(
  db: GridDb,
  table: string,
): Promise<Set<string>> {
  const rows = await rawQuery<{ name: string }>(
    db,
    `SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table.replace(/'/g, "''")}' AND COLUMN_NAME LIKE 'gc\\_%'`,
  );
  return new Set(rows.map((r) => r.name));
}

/** Creates the rows / change-log tables when `information_schema` says they are missing. */
export async function ensureTables(env: GridEnv): Promise<void> {
  const { rowsTableName, changeLogTableName } = env.tables;
  const present = await existingTables(env.db, [
    rowsTableName,
    changeLogTableName,
  ]);
  if (!present.has(rowsTableName))
    await env.db.execute(
      createRowsTableDDL({ table: rowsTableName }).sql as never,
    );
  if (!present.has(changeLogTableName)) {
    await env.db.execute(
      createChangeLogTableDDL({ table: changeLogTableName }).sql as never,
    );
  }
}

const isIndexed = (c: ColumnDef) => c.indexed === true && !c.source;

/**
 * Reconciles `gc_<key>` generated columns from `prev` to `next` with
 * `diffIndexedColumns`. `prev` is first corrected against
 * `information_schema.columns` (a column only counts as indexed when its
 * `gc_<key>` exists, and an existing `gc_<key>` for a next-indexed column
 * counts as indexed), so re-running is a no-op and a wiped database or a lost
 * schema.json both converge.
 */
export async function applyGeneratedColumns(
  env: GridEnv,
  prev: GridSchema | null,
  next: GridSchema,
  now: Date,
): Promise<string[]> {
  const table = env.tables.rowsTableName;
  const existing = await existingGeneratedColumns(env.db, table);
  const prevColumns = new Map<string, ColumnDef>();
  for (const c of prev?.columns ?? []) {
    prevColumns.set(
      c.id,
      isIndexed(c) && !existing.has(`gc_${c.key}`)
        ? { ...c, indexed: false }
        : c,
    );
  }
  for (const c of next.columns) {
    if (!isIndexed(c) || !existing.has(`gc_${c.key}`)) continue;
    const p = prevColumns.get(c.id);
    if (!p || p.key !== c.key) prevColumns.set(c.id, c);
    else if (!isIndexed(p)) prevColumns.set(c.id, { ...p, indexed: true });
  }
  const effectivePrev: GridSchema = {
    ...(prev ?? next),
    columns: [...prevColumns.values()],
  };
  const hook = formulaSqlHook({
    ctx: seedContext(next, env, now),
    tables: env.tables,
    generatedColumns: "ignore",
  });
  const statements = diffIndexedColumns(effectivePrev, next, table, {
    formulaSql: hook,
  });
  for (const stmt of statements) await env.db.execute(stmt.sql as never);
  return statements.map((s) => s.description);
}

/** Seeds core's r1..r5 fixture rows when the grid has never had a row (soft-deleted rows count). */
export async function seedIfEmpty(
  env: GridEnv,
  schema: GridSchema,
  now: Date,
): Promise<number> {
  const [row] = await rawQuery<{ n: number | string }>(
    env.db,
    `SELECT COUNT(*) AS n FROM \`${env.tables.rowsTableName}\` WHERE grid_id = '${env.gridId.replace(/'/g, "''")}'`,
  );
  if (Number(row?.n ?? 0) > 0) return 0;
  const byKey = new Set(
    schema.columns.filter((c) => c.type !== "formula").map((c) => c.key),
  );
  const partials: RowPartial[] = createFixtureRows().map((r) => ({
    id: r.id,
    cells: Object.fromEntries(
      Object.entries(r.cells).filter(([k]) => byKey.has(k)),
    ),
  }));
  const ctx = seedContext(schema, env, now);
  const created = await createRows(partials, ctx, {
    db: env.db,
    tables: env.tables,
    gridId: env.gridId,
  });
  return created.length;
}

/** Boot: tables, generated columns (diffed against the persisted schema), seed. */
export async function bootstrap(
  env: GridEnv,
  store: SchemaStore,
  persisted: GridSchema | null,
  now: Date,
): Promise<void> {
  await ensureTables(env);
  const schema = store.get();
  await applyGeneratedColumns(env, persisted, schema, now);
  store.set(schema);
  await seedIfEmpty(env, schema, now);
}

/** Dev reset: empty both tables, restore the fixture schema (and its generated columns), reseed. */
export async function resetGrid(
  env: GridEnv,
  store: SchemaStore,
  now: Date,
): Promise<void> {
  await ensureTables(env);
  await env.db.execute(
    `TRUNCATE TABLE \`${env.tables.rowsTableName}\`` as never,
  );
  await env.db.execute(
    `TRUNCATE TABLE \`${env.tables.changeLogTableName}\`` as never,
  );
  const fixture = createFixtureSchema();
  await applyGeneratedColumns(env, store.get(), fixture, now);
  store.clearFile();
  store.set(fixture);
  await seedIfEmpty(env, fixture, now);
}
