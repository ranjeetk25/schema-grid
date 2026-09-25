import { describe, expect, it } from "vitest";
import { queryFingerprint } from "../../../src/pagination/cursor";
import { cursorFromRow, keysetPredicate } from "../../../src/pagination/keyset";
import { translateSort } from "../../../src/sort/translate-sort";
import { allTypesSchema, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema = allTypesSchema();
const scope = makeScope(makeCtx(schema));

describe("keysetPredicate", () => {
  it("snapshot for [fee desc, name asc] with explicit params", () => {
    const { keys } = translateSort(
      [
        { columnId: "fee", dir: "desc" },
        { columnId: "name", dir: "asc" },
      ],
      scope,
    );
    const { sql: rendered, params } = renderSql(keysetPredicate(keys, { keys: [120, "bob"], id: "row1" }));

    expect(rendered).toMatchInlineSnapshot(
      `"((((CASE WHEN (JSON_EXTRACT(\`cells\`, '$.fee') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) = 'NULL') THEN 1 ELSE 0 END) = 1 OR CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) < ?)) OR (((CASE WHEN (JSON_EXTRACT(\`cells\`, '$.fee') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) = 'NULL') THEN 1 ELSE 0 END) = 0 AND CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) = ?) AND ((CASE WHEN (JSON_EXTRACT(\`cells\`, '$.name') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL' OR JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name')) COLLATE utf8mb4_0900_ai_ci = '') THEN 1 ELSE 0 END) = 1 OR JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name')) COLLATE utf8mb4_0900_ai_ci > ?)) OR (((CASE WHEN (JSON_EXTRACT(\`cells\`, '$.fee') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) = 'NULL') THEN 1 ELSE 0 END) = 0 AND CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) = ?) AND ((CASE WHEN (JSON_EXTRACT(\`cells\`, '$.name') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL' OR JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name')) COLLATE utf8mb4_0900_ai_ci = '') THEN 1 ELSE 0 END) = 0 AND JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name')) COLLATE utf8mb4_0900_ai_ci = ?) AND \`id\` > ?))"`,
    );
    expect(params).toEqual([120, 120, "bob", 120, "bob", "row1"]);
  });

  it("a null cursor key with nulls last: branch requires the key also null, then compares later keys / id", () => {
    const { keys } = translateSort([{ columnId: "fee", dir: "asc" }], scope);
    const { sql: rendered, params } = renderSql(keysetPredicate(keys, { keys: [null], id: "row1" }));
    // Only branch left is: fee IS empty (nullFlag = 1) AND id > cursor id.
    expect(rendered).toBe(
      "((" +
        "(CASE WHEN (JSON_EXTRACT(`cells`, '$.fee') IS NULL OR JSON_TYPE(JSON_EXTRACT(`cells`, '$.fee')) = 'NULL') THEN 1 ELSE 0 END) = 1" +
        " AND `id` > ?))",
    );
    expect(params).toEqual(["row1"]);
  });

  it("converts a datetime cursor value to the DATETIME(3) literal shape when binding", () => {
    const { keys } = translateSort([{ columnId: "calledAt", dir: "asc" }], scope);
    const { params } = renderSql(keysetPredicate(keys, { keys: ["2026-01-01T10:20:30.123Z"], id: "row1" }));
    expect(params).toContain("2026-01-01 10:20:30.123");
    expect(params).not.toContain("2026-01-01T10:20:30.123Z");
  });

  it("id-only keyset (empty sort) reduces to a single id > ? branch", () => {
    const { keys } = translateSort([], scope);
    const { sql: rendered, params } = renderSql(keysetPredicate(keys, { keys: [], id: "row9" }));
    expect(rendered).toBe("((`id` > ?))");
    expect(params).toEqual(["row9"]);
  });
});

describe("cursorFromRow", () => {
  it("builds the next cursor from the last row's cell values", () => {
    const { keys } = translateSort(
      [
        { columnId: "fee", dir: "desc" },
        { columnId: "name", dir: "asc" },
      ],
      scope,
    );
    const fp = queryFingerprint({ filter: null, sort: [], search: undefined, groupBy: [] });
    const row = {
      id: "row1",
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cells: { fee: 120, name: "bob" },
    };
    const payload = cursorFromRow(row, keys, scope, fp);
    expect(payload).toEqual({ v: 1, mode: "keyset", fp, keys: [120, "bob"], id: "row1" });
  });

  it("normalizes empty values (undefined/''/[]) to null", () => {
    const { keys } = translateSort([{ columnId: "name", dir: "asc" }], scope);
    const fp = "fp1";
    const row = { id: "row2", version: 1, updatedAt: "2026-01-01T00:00:00.000Z", cells: { name: "" } };
    const payload = cursorFromRow(row, keys, scope, fp);
    expect(payload.keys).toEqual([null]);
  });

  it("keeps datetime values as ISO strings", () => {
    const { keys } = translateSort([{ columnId: "calledAt", dir: "asc" }], scope);
    const row = {
      id: "row3",
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cells: { calledAt: "2026-02-03T04:05:06.000Z" },
    };
    const payload = cursorFromRow(row, keys, scope, "fp1");
    expect(payload.keys).toEqual(["2026-02-03T04:05:06.000Z"]);
  });
});
