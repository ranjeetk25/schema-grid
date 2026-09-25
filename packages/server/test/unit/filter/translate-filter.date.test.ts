import { describe, expect, it } from "vitest";
import { translateFilter } from "../../../src/filter/translate-filter";
import type { FilterNode } from "../../../src/internal/core";
import { localDayStartUtc, toLocalDate, toMysqlUtc } from "../../../src/sql/dates";
import { allTypesSchema, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema = allTypesSchema();
/** 2026-09-25 00:30 in Kolkata = 2026-09-24T19:00Z — the UTC day is still the 24th. */
const NOW = new Date("2026-09-25T00:30:00+05:30");
const TZ = "Asia/Kolkata";
const tAt = (now: Date, node: FilterNode) => {
  const out = translateFilter(node, makeScope(makeCtx(schema, { now, tz: TZ })));
  if (!out) throw new Error("expected SQL");
  return renderSql(out);
};
const t = (node: FilterNode) => tAt(NOW, node);

const CD = "CAST(IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.callDate')), NULL) AS DATE)";
const CD_EMPTY = `(${CD} IS NULL)`;
const CA = "CAST(REPLACE(REPLACE(IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.calledAt')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.calledAt')), NULL), 'T', ' '), 'Z', '') AS DATETIME(3))";
const CA_EMPTY = `(${CA} IS NULL)`;

describe("sql/dates helpers", () => {
  it("toMysqlUtc renders UTC with milliseconds", () => {
    expect(toMysqlUtc("2026-09-24T19:00:00+05:30")).toBe("2026-09-24 13:30:00.000");
    expect(toMysqlUtc("2026-09-24T13:30:00.123Z")).toBe("2026-09-24 13:30:00.123");
  });

  it("toLocalDate gives the calendar day in tz", () => {
    expect(toLocalDate("2026-09-24T19:00:00.000Z", TZ)).toBe("2026-09-25");
    expect(toLocalDate("2026-09-24T19:00:00.000Z", "UTC")).toBe("2026-09-24");
    expect(toLocalDate("2026-09-24T19:00:00.000Z", "America/Los_Angeles")).toBe("2026-09-24");
  });

  it("localDayStartUtc is local midnight as a UTC ISO instant (DST-aware)", () => {
    expect(localDayStartUtc("2026-09-24", TZ)).toBe("2026-09-23T18:30:00.000Z");
    expect(localDayStartUtc("2026-07-01", "America/New_York")).toBe("2026-07-01T04:00:00.000Z");
    expect(localDayStartUtc("2026-01-01", "America/New_York")).toBe("2026-01-01T05:00:00.000Z");
    // 2026-03-08 is the US spring-forward day; midnight itself exists (still EST).
    expect(localDayStartUtc("2026-03-08", "America/New_York")).toBe("2026-03-08T05:00:00.000Z");
  });
});

describe("translateFilter: date column", () => {
  it("isWithin yesterday binds the LOCAL (Kolkata) day, not the UTC day", () => {
    const r = t({ columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } });
    expect(r.sql).toBe(`(${CD} >= ? AND ${CD} < ? AND NOT ${CD_EMPTY})`);
    expect(r.params).toEqual(["2026-09-24", "2026-09-25"]);
  });

  it("lastNDays n=7 binds a 7-day window including today", () => {
    const r = t({ columnId: "callDate", operator: "isWithin", value: { relative: "lastNDays", n: 7 } });
    expect(r.params).toEqual(["2026-09-19", "2026-09-26"]);
  });

  it("the same AST a day later shifts by one day (a saved view keeps meaning 'yesterday')", () => {
    const node: FilterNode = { columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } };
    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(tAt(later, node).params).toEqual(["2026-09-25", "2026-09-26"]);
    const dt: FilterNode = { columnId: "calledAt", operator: "isWithin", value: { relative: "yesterday" } };
    expect(tAt(later, dt).params).toEqual(["2026-09-24 18:30:00.000", "2026-09-25 18:30:00.000"]);
  });

  it("invalid relative dates are unusable → FALSE", () => {
    expect(t({ columnId: "callDate", operator: "isWithin", value: { relative: "lastNDays" } }).sql).toBe(
      `(FALSE AND NOT ${CD_EMPTY})`,
    );
    expect(t({ columnId: "callDate", operator: "isWithin", value: "yesterday" }).sql).toBe(`(FALSE AND NOT ${CD_EMPTY})`);
  });

  it("is / isBefore / isAfter; a full ISO value is converted to the local day", () => {
    const is = t({ columnId: "callDate", operator: "is", value: "2026-09-24" });
    expect(is.sql).toBe(`(${CD} = ? AND NOT ${CD_EMPTY})`);
    expect(is.params).toEqual(["2026-09-24"]);
    expect(t({ columnId: "callDate", operator: "is", value: "2026-09-24T19:00:00.000Z" }).params).toEqual(["2026-09-25"]);
    const before = t({ columnId: "callDate", operator: "isBefore", value: "2026-09-24" });
    expect(before.sql).toBe(`(${CD} < ? AND NOT ${CD_EMPTY})`);
    const after = t({ columnId: "callDate", operator: "isAfter", value: "2026-09-24" });
    expect(after.sql).toBe(`(${CD} > ? AND NOT ${CD_EMPTY})`);
    expect(after.params).toEqual(["2026-09-24"]);
  });

  it("isBetween is inclusive of BOTH ends on a date column", () => {
    // Inclusive `to` is deliberate: it must match core's in-memory matchesFilter
    // for date isBetween (from <= d <= to), so server and client agree.
    const r = t({ columnId: "callDate", operator: "isBetween", value: { from: "2026-09-01", to: "2026-09-30" } });
    expect(r.sql).toBe(`(${CD} >= ? AND ${CD} <= ? AND NOT ${CD_EMPTY})`);
    expect(r.params).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("invalid date values are unusable → FALSE", () => {
    const FALSE = `(FALSE AND NOT ${CD_EMPTY})`;
    expect(t({ columnId: "callDate", operator: "is", value: "2026-02-30" }).sql).toBe(FALSE);
    expect(t({ columnId: "callDate", operator: "is", value: "2026-02-30T10:00:00Z" }).sql).toBe(FALSE);
    expect(t({ columnId: "callDate", operator: "is", value: "yesterday" }).sql).toBe(FALSE);
    expect(t({ columnId: "callDate", operator: "is", value: 20260924 }).sql).toBe(FALSE);
    expect(t({ columnId: "callDate", operator: "isBetween", value: "2026-09-01" }).sql).toBe(FALSE);
    expect(t({ columnId: "callDate", operator: "isBetween", value: { from: "nope", to: null } }).sql).toBe(FALSE);
  });

  it("values are trimmed", () => {
    expect(t({ columnId: "callDate", operator: "is", value: " 2026-09-24 " }).params).toEqual(["2026-09-24"]);
  });

  it("instant values compare against the cell's start-of-day instant", () => {
    // 12:00 Kolkata on the 24th: start(24th) < v, so the 24th IS before it.
    const before = t({ columnId: "callDate", operator: "isBefore", value: "2026-09-24T12:00:00+05:30" });
    expect(before.sql).toBe(`(${CD} < ? AND NOT ${CD_EMPTY})`);
    expect(before.params).toEqual(["2026-09-25"]);
    // Exactly local midnight of the 24th: the 24th is NOT before it.
    expect(t({ columnId: "callDate", operator: "isBefore", value: "2026-09-24T00:00:00+05:30" }).params).toEqual([
      "2026-09-24",
    ]);
    // isAfter an instant: start(D) > v → D >= next day (also for a midnight instant).
    const after = t({ columnId: "callDate", operator: "isAfter", value: "2026-09-24T12:00:00+05:30" });
    expect(after.sql).toBe(`(${CD} >= ? AND NOT ${CD_EMPTY})`);
    expect(after.params).toEqual(["2026-09-25"]);
    expect(t({ columnId: "callDate", operator: "isAfter", value: "2026-09-24T00:00:00+05:30" }).params).toEqual([
      "2026-09-25",
    ]);
    // isBetween: from an instant mid-day excludes that day; to an instant includes its day.
    const between = t({
      columnId: "callDate",
      operator: "isBetween",
      value: { from: "2026-09-01T12:00:00+05:30", to: "2026-09-30T00:00:00+05:30" },
    });
    expect(between.sql).toBe(`(${CD} >= ? AND ${CD} < ? AND NOT ${CD_EMPTY})`);
    expect(between.params).toEqual(["2026-09-02", "2026-10-01"]);
  });

  it("isBetween: null/blank bounds are open; both open matches any non-empty cell", () => {
    const from = t({ columnId: "callDate", operator: "isBetween", value: { from: "2026-09-01", to: " " } });
    expect(from.sql).toBe(`(${CD} >= ? AND NOT ${CD_EMPTY})`);
    expect(t({ columnId: "callDate", operator: "isBetween", value: { from: null, to: null } }).sql).toBe(
      `(TRUE AND NOT ${CD_EMPTY})`,
    );
  });

  it("isEmpty uses the empty predicate", () => {
    expect(t({ columnId: "callDate", operator: "isEmpty" }).sql).toBe(CD_EMPTY);
    expect(t({ columnId: "callDate", operator: "isNotEmpty" }).sql).toBe(`NOT ${CD_EMPTY}`);
  });
});

describe("translateFilter: datetime column", () => {
  it("isWithin yesterday binds UTC bounds of the Kolkata day", () => {
    const r = t({ columnId: "calledAt", operator: "isWithin", value: { relative: "yesterday" } });
    expect(r.sql).toBe(`(${CA} >= ? AND ${CA} < ? AND NOT ${CA_EMPTY})`);
    expect(r.params).toEqual(["2026-09-23 18:30:00.000", "2026-09-24 18:30:00.000"]);
  });

  it("is with a plain date means that local day [start, nextStart)", () => {
    const r = t({ columnId: "calledAt", operator: "is", value: "2026-09-24" });
    expect(r.sql).toBe(`(${CA} >= ? AND ${CA} < ? AND NOT ${CA_EMPTY})`);
    expect(r.params).toEqual(["2026-09-23 18:30:00.000", "2026-09-24 18:30:00.000"]);
  });

  it("is with a full ISO value means the same LOCAL day as that instant", () => {
    const r = t({ columnId: "calledAt", operator: "is", value: "2026-09-24T10:00:00.000+05:30" });
    expect(r.sql).toBe(`(${CA} >= ? AND ${CA} < ? AND NOT ${CA_EMPTY})`);
    expect(r.params).toEqual(["2026-09-23 18:30:00.000", "2026-09-24 18:30:00.000"]);
    // 20:00Z on the 24th is already the 25th in Kolkata.
    expect(t({ columnId: "calledAt", operator: "is", value: "2026-09-24T20:00:00Z" }).params).toEqual([
      "2026-09-24 18:30:00.000",
      "2026-09-25 18:30:00.000",
    ]);
  });

  it("accepts core's ISO forms: up to 9 fractional digits (truncated to ms), lowercase t/z, +HHMM", () => {
    expect(t({ columnId: "calledAt", operator: "isBefore", value: "2026-09-24T10:00:00.123956789Z" }).params).toEqual([
      "2026-09-24 10:00:00.123",
    ]);
    expect(t({ columnId: "calledAt", operator: "isBefore", value: "2026-09-24t10:00:00z" }).params).toEqual([
      "2026-09-24 10:00:00.000",
    ]);
    expect(t({ columnId: "calledAt", operator: "isBefore", value: "2026-09-24T10:00+0530" }).params).toEqual([
      "2026-09-24 04:30:00.000",
    ]);
  });

  it("isBefore / isAfter with a plain date: before the day starts / from the next day on", () => {
    const before = t({ columnId: "calledAt", operator: "isBefore", value: "2026-09-24" });
    expect(before.sql).toBe(`(${CA} < ? AND NOT ${CA_EMPTY})`);
    expect(before.params).toEqual(["2026-09-23 18:30:00.000"]);
    const after = t({ columnId: "calledAt", operator: "isAfter", value: "2026-09-24" });
    expect(after.sql).toBe(`(${CA} >= ? AND NOT ${CA_EMPTY})`);
    expect(after.params).toEqual(["2026-09-24 18:30:00.000"]);
  });

  it("isBefore / isAfter with ISO values are strict instant comparisons", () => {
    const before = t({ columnId: "calledAt", operator: "isBefore", value: "2026-09-24T00:00:00Z" });
    expect(before.sql).toBe(`(${CA} < ? AND NOT ${CA_EMPTY})`);
    expect(before.params).toEqual(["2026-09-24 00:00:00.000"]);
    const after = t({ columnId: "calledAt", operator: "isAfter", value: "2026-09-24T00:00:00Z" });
    expect(after.sql).toBe(`(${CA} > ? AND NOT ${CA_EMPTY})`);
  });

  it("isBetween: plain dates cover whole local days; ISO bounds are inclusive instants", () => {
    const days = t({ columnId: "calledAt", operator: "isBetween", value: { from: "2026-09-01", to: "2026-09-30" } });
    expect(days.sql).toBe(`(${CA} >= ? AND ${CA} < ? AND NOT ${CA_EMPTY})`);
    expect(days.params).toEqual(["2026-08-31 18:30:00.000", "2026-09-30 18:30:00.000"]);
    const iso = t({
      columnId: "calledAt",
      operator: "isBetween",
      value: { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" },
    });
    expect(iso.sql).toBe(`(${CA} >= ? AND ${CA} <= ? AND NOT ${CA_EMPTY})`);
    expect(iso.params).toEqual(["2026-09-01 00:00:00.000", "2026-09-02 00:00:00.000"]);
  });

  it("ISO values without an offset are unusable (ambiguous instant) → FALSE", () => {
    expect(t({ columnId: "calledAt", operator: "is", value: "2026-09-24T10:00:00" }).sql).toBe(
      `(FALSE AND NOT ${CA_EMPTY})`,
    );
  });

  it("isBetween with one open bound", () => {
    const r = t({ columnId: "calledAt", operator: "isBetween", value: { from: null, to: "2026-09-30" } });
    expect(r.sql).toBe(`(${CA} < ? AND NOT ${CA_EMPTY})`);
    expect(r.params).toEqual(["2026-09-30 18:30:00.000"]);
  });
});

describe("translateFilter: §8 combined filter", () => {
  it("and[paymentStatus isNot paid, callDate isWithin yesterday]", () => {
    const r = t({
      op: "and",
      children: [
        { columnId: "paymentStatus", operator: "isNot", value: "paid" },
        { columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } },
      ],
    });
    expect(r).toMatchInlineSnapshot(`
      {
        "params": [
          "paid",
          "2026-09-24",
          "2026-09-25",
        ],
        "sql": "((IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci <> ? OR (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR REGEXP_LIKE(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci, '^[[:space:]]*$'))) AND (CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) >= ? AND CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) < ? AND NOT (CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) IS NULL)))",
      }
    `);
    expect(r.params).toEqual(["paid", "2026-09-24", "2026-09-25"]);
  });
});
