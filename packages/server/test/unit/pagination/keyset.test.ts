import { describe, expect, it } from "vitest";
import { queryFingerprint } from "../../../src/pagination/cursor";
import { cursorFromDbRow, keysetPredicate } from "../../../src/pagination/keyset";
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
      `"((((CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) = 1 OR (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END) < ?)) OR (((CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) = 0 AND (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END) = ?) AND ((CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR REGEXP_LIKE(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci, '^[[:space:]]*$')) THEN 1 ELSE 0 END) = 1 OR (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR REGEXP_LIKE(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci, '^[[:space:]]*$')) THEN NULL ELSE IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci END) > ?)) OR (((CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) = 0 AND (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END) = ?) AND ((CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR REGEXP_LIKE(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci, '^[[:space:]]*$')) THEN 1 ELSE 0 END) = 0 AND (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR REGEXP_LIKE(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci, '^[[:space:]]*$')) THEN NULL ELSE IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci END) = ?) AND \`id\` > ?))"`,
    );
    expect(params).toEqual([120, 120, "bob", 120, "bob", "row1"]);
  });

  it("a null cursor key with nulls last: branch requires the key also null, then compares later keys / id", () => {
    const { keys } = translateSort([{ columnId: "fee", dir: "asc" }], scope);
    const { sql: rendered, params } = renderSql(keysetPredicate(keys, { keys: [null], id: "row1" }));
    // Only branch left is: fee IS empty (nullFlag = 1) AND id > cursor id.
    expect(rendered).toBe(
      "((" +
        "(CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(`cells`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(`cells`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) = 1" +
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

describe("cursorFromDbRow", () => {
  it("builds the next cursor from the last DB row's raw sort-key select values", () => {
    const { keys } = translateSort(
      [
        { columnId: "fee", dir: "desc" },
        { columnId: "name", dir: "asc" },
      ],
      scope,
    );
    const fp = queryFingerprint({ filter: null, sort: [], search: undefined, groupBy: [] });
    const dbRow = { id: "row1", __sk0: 120, __sn0: 0, __sk1: "bob", __sn1: 0 };
    const payload = cursorFromDbRow(dbRow, keys, fp);
    expect(payload).toEqual({ v: 1, mode: "keyset", fp, keys: [120, "bob"], id: "row1" });
  });

  it("treats a null flag of 1 as a null key regardless of the raw value", () => {
    const { keys } = translateSort([{ columnId: "name", dir: "asc" }], scope);
    const fp = "fp1";
    const dbRow = { id: "row2", __sk0: "", __sn0: 1 };
    const payload = cursorFromDbRow(dbRow, keys, fp);
    expect(payload.keys).toEqual([null]);
  });

  it("keeps datetime values as ISO strings", () => {
    const { keys } = translateSort([{ columnId: "calledAt", dir: "asc" }], scope);
    const dbRow = { id: "row3", __sk0: "2026-02-03T04:05:06.000Z", __sn0: 0 };
    const payload = cursorFromDbRow(dbRow, keys, "fp1");
    expect(payload.keys).toEqual(["2026-02-03T04:05:06.000Z"]);
  });

  it("preserves a raw DECIMAL string exactly, without float rounding", () => {
    const { keys } = translateSort([{ columnId: "fee", dir: "asc" }], scope);
    const dbRow = { id: "row4", __sk0: "1.2345678901", __sn0: 0 };
    const payload = cursorFromDbRow(dbRow, keys, "fp1");
    expect(payload.keys).toEqual(["1.2345678901"]);
  });
});
