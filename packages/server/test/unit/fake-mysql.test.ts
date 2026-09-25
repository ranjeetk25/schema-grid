import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asRows, createFakeMysql } from "../helpers/fake-mysql";
import { tables } from "../helpers/schemas";

describe("fake mysql helper", () => {
  it("runs real drizzle builders inside a transaction and maps results", async () => {
    const { db, calls, statements } = createFakeMysql((c) =>
      c.rowsAsArray
        ? asRows([{ id: "r1", version: 2 }], ["id", "version"])
        : c.sql.startsWith("update")
          ? { affectedRows: 1 }
          : undefined,
    );
    const out = await db.transaction(async (tx) => {
      const rows = await tx.select({ id: tables.rows.id, version: tables.rows.version }).from(tables.rows);
      const [res] = await tx.update(tables.rows).set({ version: 3 }).where(eq(tables.rows.id, "r1"));
      return { rows, affected: res.affectedRows };
    });
    expect(out).toEqual({ rows: [{ id: "r1", version: 2 }], affected: 1 });
    expect(calls.map((c) => c.sql.split(" ")[0])).toEqual(["begin", "select", "update", "commit"]);
    expect(statements()).toHaveLength(2);
  });
});
