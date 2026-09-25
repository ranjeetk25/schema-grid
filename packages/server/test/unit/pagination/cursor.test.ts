import { describe, expect, it } from "vitest";
import { CursorError } from "../../../src/errors";
import {
  assertCursorMatches,
  decodeCursor,
  encodeCursor,
  queryFingerprint,
  type CursorPayload,
} from "../../../src/pagination/cursor";
import { MAX_PAGE_LIMIT, hasNextPage, offsetClause, trimPage } from "../../../src/pagination/offset";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a keyset payload", () => {
    const payload: CursorPayload = { v: 1, mode: "keyset", fp: "abc123", keys: ["x", 1, null, true], id: "row1" };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it("round-trips an offset payload", () => {
    const payload: CursorPayload = { v: 1, mode: "offset", fp: "abc123", offset: 40 };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it("throws CursorError on tampered / malformed base64", () => {
    const good = encodeCursor({ v: 1, mode: "offset", fp: "abc", offset: 0 });
    expect(() => decodeCursor(`${good}garbage!!not-json`)).toThrow(CursorError);
    expect(() => decodeCursor("not-a-valid-cursor-at-all-@@@")).toThrow(CursorError);
  });

  it("throws CursorError on wrong version or missing fields", () => {
    const bad = Buffer.from(JSON.stringify({ v: 2, mode: "offset", fp: "abc" }), "utf8").toString("base64url");
    expect(() => decodeCursor(bad)).toThrow(CursorError);
    const missingFp = Buffer.from(JSON.stringify({ v: 1, mode: "offset" }), "utf8").toString("base64url");
    expect(() => decodeCursor(missingFp)).toThrow(CursorError);
  });
});

describe("queryFingerprint / assertCursorMatches", () => {
  const queryA = { filter: null, sort: [{ columnId: "name", dir: "asc" as const }], search: undefined, groupBy: [] };
  const queryB = { filter: null, sort: [{ columnId: "fee", dir: "desc" as const }], search: undefined, groupBy: [] };

  it("is stable for the same query and differs for a different one", () => {
    expect(queryFingerprint(queryA)).toBe(queryFingerprint(queryA));
    expect(queryFingerprint(queryA)).not.toBe(queryFingerprint(queryB));
  });

  it("ignores key order (canonical JSON)", () => {
    const q1 = { filter: { a: 1, b: 2 }, sort: [], search: "x" } as never;
    const q2 = { filter: { b: 2, a: 1 }, sort: [], search: "x" } as never;
    expect(queryFingerprint(q1)).toBe(queryFingerprint(q2));
  });

  it("a cursor built for query A used against query B throws", () => {
    const fpA = queryFingerprint(queryA);
    const fpB = queryFingerprint(queryB);
    const cursor = decodeCursor(encodeCursor({ v: 1, mode: "keyset", fp: fpA, keys: [], id: "r1" }));
    expect(() => assertCursorMatches(cursor, fpB)).toThrow(CursorError);
    expect(() => assertCursorMatches(cursor, fpA)).not.toThrow();
  });
});

describe("offsetClause / hasNextPage / trimPage", () => {
  it("clamps limit into 1..MAX_PAGE_LIMIT and offset to >= 0", () => {
    expect(offsetClause({ limit: 0 })).toEqual({ limit: 1, offset: 0 });
    expect(offsetClause({ limit: 5000 })).toEqual({ limit: MAX_PAGE_LIMIT, offset: 0 });
    expect(offsetClause({ limit: 50, offset: -10 })).toEqual({ limit: 50, offset: 0 });
    expect(offsetClause({ limit: 50, offset: 30.9 })).toEqual({ limit: 50, offset: 30 });
  });

  it("hasNextPage / trimPage report whether more rows exist beyond limit+1", () => {
    const rows = [1, 2, 3, 4];
    expect(hasNextPage(rows, 3)).toBe(true);
    expect(trimPage(rows, 3)).toEqual({ rows: [1, 2, 3], hasMore: true });

    expect(hasNextPage(rows, 4)).toBe(false);
    expect(trimPage(rows, 10)).toEqual({ rows, hasMore: false });
  });
});
