import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { FIXTURE_GRID_ID, FIXTURE_NOW, createServerFixtureRowPartials, serverFixtureSchema } from "../fixtures/admissions";
import { MYSQL_IT_ENABLED, type StartedMysql, describeMysql, setupGrid, startMysql } from "./mysql";

const NOW = new Date(FIXTURE_NOW);
const rowPartials = createServerFixtureRowPartials();

describeMysql("mysql integration harness", () => {
  let mysql: StartedMysql;
  beforeAll(async () => {
    mysql = await startMysql();
    await setupGrid(mysql.db, serverFixtureSchema, rowPartials, { gridId: FIXTURE_GRID_ID, now: NOW });
  }, 180_000);
  afterAll(async () => {
    await mysql?.stop();
  });

  it("applies the DDL and seeds the fixture", async () => {
    const [rows] = (await mysql.db.execute(sql`SELECT COUNT(*) AS n FROM grid_rows`)) as unknown as [{ n: number }[]];
    expect(Number(rows[0]?.n)).toBe(rowPartials.length);
  });

  it("creates the generated column index for the indexed column", async () => {
    const [idx] = (await mysql.db.execute(sql`SHOW INDEX FROM grid_rows`)) as unknown as [{ Key_name: string }[]];
    expect(idx.map((i) => i.Key_name)).toContain("idx_gc_fee");
  });
});

it("integration suite is gated by SCHEMA_GRID_MYSQL_IT", () => {
  expect(typeof MYSQL_IT_ENABLED).toBe("boolean");
});
