import { describe, expect, it } from "vitest";
import { parseCsvText } from "../src/import/csv";
import {
  buildErrorReportCsv,
  createImportJobState,
  recordChunkResult,
} from "../src/import/job-state";
import type {
  ImportJobState,
  ImportRowError,
  ParsedTable,
} from "../src/import/types";
import type { ChangeResult } from "../src/internal/core";

function err(sourceRow: number, message = "bad"): ImportRowError {
  return { sourceRow, message };
}

describe("createImportJobState", () => {
  it("with no initial errors starts at zero processed/failed", () => {
    const state = createImportJobState(10);
    expect(state).toEqual({ total: 10, processed: 0, failed: 0, errors: [] });
  });

  it("counts distinct source rows among initial errors as processed and failed", () => {
    const initial = [err(1, "a"), err(2, "b")];
    const state = createImportJobState(10, initial);
    expect(state.processed).toBe(2);
    expect(state.failed).toBe(2);
    expect(state.errors).toEqual(initial);
  });

  it("counts a row with two initial errors once", () => {
    const initial = [err(1, "a"), err(1, "b")];
    const state = createImportJobState(10, initial);
    expect(state.processed).toBe(1);
    expect(state.failed).toBe(1);
  });

  it("copies the initialErrors array (not the same reference)", () => {
    const initial = [err(1)];
    const state = createImportJobState(10, initial);
    expect(state.errors).not.toBe(initial);
    expect(state.errors).toEqual(initial);
  });
});

describe("recordChunkResult", () => {
  function emptyResult(): ChangeResult {
    return { applied: [], conflicts: [], errors: [] };
  }

  it("does not mutate the input state", () => {
    const state = createImportJobState(10, [err(1)]);
    const snapshot = structuredClone(state);
    recordChunkResult(
      state,
      { kind: "create", rowCount: 1, sourceRows: [2] },
      emptyResult(),
    );
    expect(state).toEqual(snapshot);
    expect(state.errors).toEqual(snapshot.errors);
  });

  it("a chunk with a conflict and an error on different rows adds rowCount to processed and 2 to failed", () => {
    const state = createImportJobState(500);
    const sourceRowsByRowId: Record<string, number> = {};
    for (let i = 0; i < 500; i++) sourceRowsByRowId[`row-${i}`] = i + 1;

    const result: ChangeResult = {
      applied: [],
      conflicts: [
        {
          rowId: "row-0",
          columnId: "c_name",
          serverValue: "x",
          serverVersion: 2,
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      errors: [
        { rowId: "row-1", columnId: "c_email", message: "invalid email" },
      ],
    };

    const next = recordChunkResult(
      state,
      { kind: "update", rowCount: 500, sourceRowsByRowId },
      result,
    );

    expect(next.processed).toBe(500);
    expect(next.failed).toBe(2);
    expect(next.errors).toHaveLength(2);
    expect(next.errors).toContainEqual({
      sourceRow: 1,
      columnId: "c_name",
      message: "Changed by someone else since the import started",
    });
    expect(next.errors).toContainEqual({
      sourceRow: 2,
      columnId: "c_email",
      message: "invalid email",
    });
  });

  it("a whole-chunk failure marks every row in the chunk (create)", () => {
    const state = createImportJobState(3);
    const next = recordChunkResult(
      state,
      { kind: "create", rowCount: 3, sourceRows: [1, 2, 3] },
      { error: "Network error" },
    );
    expect(next.processed).toBe(3);
    expect(next.failed).toBe(3);
    expect(next.errors).toHaveLength(3);
    for (const sourceRow of [1, 2, 3]) {
      expect(next.errors).toContainEqual({
        sourceRow,
        message: "Network error",
      });
    }
  });

  it("a whole-chunk failure marks every row in the chunk (update)", () => {
    const state = createImportJobState(2);
    const sourceRowsByRowId = { "row-a": 5, "row-b": 6 };
    const next = recordChunkResult(
      state,
      { kind: "update", rowCount: 2, sourceRowsByRowId },
      { error: "Server exploded" },
    );
    expect(next.processed).toBe(2);
    expect(next.failed).toBe(2);
    expect(next.errors).toHaveLength(2);
    for (const sourceRow of [5, 6]) {
      expect(next.errors).toContainEqual({
        sourceRow,
        message: "Server exploded",
      });
    }
  });

  it("a row that errors in two separate chunks is counted once in failed", () => {
    let state = createImportJobState(2);
    state = recordChunkResult(
      state,
      { kind: "create", rowCount: 1, sourceRows: [1] },
      { error: "first failure" },
    );
    state = recordChunkResult(
      state,
      { kind: "create", rowCount: 1, sourceRowsByRowId: { r1: 1 } },
      {
        applied: [],
        conflicts: [],
        errors: [{ rowId: "r1", columnId: "c_x", message: "second failure" }],
      },
    );
    expect(state.processed).toBe(2);
    expect(state.failed).toBe(1);
    expect(state.errors).toHaveLength(2);
  });

  it("falls back to sourceRow 0 and prefixes the message with the row id when the rowId is unmapped", () => {
    const state = createImportJobState(1);
    const next = recordChunkResult(
      state,
      { kind: "update", rowCount: 1, sourceRowsByRowId: {} },
      {
        applied: [],
        conflicts: [],
        errors: [{ rowId: "row-unmapped", columnId: "c_x", message: "oops" }],
      },
    );
    expect(next.errors).toHaveLength(1);
    expect(next.errors[0]?.sourceRow).toBe(0);
    expect(next.errors[0]?.message).toContain("row-unmapped");
    expect(next.errors[0]?.message).toContain("oops");
  });

  it("accumulates processed/failed across successive calls", () => {
    let state = createImportJobState(1000);
    state = recordChunkResult(
      state,
      {
        kind: "create",
        rowCount: 500,
        sourceRows: Array.from({ length: 500 }, (_, i) => i + 1),
      },
      { applied: [], conflicts: [], errors: [] },
    );
    state = recordChunkResult(
      state,
      {
        kind: "create",
        rowCount: 500,
        sourceRows: Array.from({ length: 500 }, (_, i) => i + 501),
      },
      {
        applied: [],
        conflicts: [],
        errors: [{ rowId: "ignored", columnId: "c_x", message: "x" }],
      },
    );
    expect(state.processed).toBe(1000);
  });
});

describe("buildErrorReportCsv", () => {
  function state(errors: ImportRowError[]): ImportJobState {
    return createImportJobState(errors.length, errors);
  }

  it("starts with a UTF-8 BOM and has the base header", () => {
    const csv = buildErrorReportCsv(state([]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith("﻿Row,Column,Error")).toBe(true);
  });

  it("round-trips a message containing a comma and newline via parseCsvText", () => {
    const csv = buildErrorReportCsv(
      state([
        {
          sourceRow: 2,
          columnId: "c_name",
          message: "has, a comma\nand a newline",
        },
      ]),
    );
    const parsed = parseCsvText(csv);
    expect(parsed.headers).toEqual(["Row", "Column", "Error"]);
    expect(parsed.rows).toEqual([
      ["2", "c_name", "has, a comma\nand a newline"],
    ]);
  });

  it("uses an empty string for a missing columnId", () => {
    const csv = buildErrorReportCsv(
      state([{ sourceRow: 3, message: "row-level error" }]),
    );
    const parsed = parseCsvText(csv);
    expect(parsed.rows).toEqual([["3", "", "row-level error"]]);
  });

  it("appends the original headers and row values when parsed is supplied", () => {
    const parsed: ParsedTable = {
      headers: ["Name", "Email"],
      rows: [
        ["Alice", "alice@example.com"],
        ["Bob", "bob@example.com"],
      ],
      truncated: false,
    };
    const csv = buildErrorReportCsv(
      state([{ sourceRow: 3, columnId: "c_email", message: "invalid" }]),
      parsed,
    );
    const result = parseCsvText(csv);
    expect(result.headers).toEqual(["Row", "Column", "Error", "Name", "Email"]);
    // sourceRow 3, headerRow defaults to 1 -> parsed.rows[3 - 1 - 1] = parsed.rows[1] (Bob)
    expect(result.rows).toEqual([
      ["3", "c_email", "invalid", "Bob", "bob@example.com"],
    ]);
  });

  it("respects a non-default headerRow when mapping sourceRow to original values", () => {
    const parsed: ParsedTable = {
      headers: ["Name"],
      rows: [["Alice"], ["Bob"]],
      truncated: false,
      headerRow: 2,
    };
    // headerRow 2 -> row 3 is parsed.rows[0], row 4 is parsed.rows[1]
    const csv = buildErrorReportCsv(
      state([{ sourceRow: 3, message: "bad" }]),
      parsed,
    );
    const result = parseCsvText(csv);
    expect(result.rows[0]).toEqual(["3", "", "bad", "Alice"]);
  });

  it("uses blank original values when sourceRow is 0 or out of range", () => {
    const parsed: ParsedTable = {
      headers: ["Name"],
      rows: [["Alice"]],
      truncated: false,
    };
    const csv = buildErrorReportCsv(
      state([
        { sourceRow: 0, message: "row-id unmapped: oops" },
        { sourceRow: 99, message: "out of range" },
      ]),
      parsed,
    );
    const result = parseCsvText(csv);
    expect(result.rows).toEqual([
      ["0", "", "row-id unmapped: oops", ""],
      ["99", "", "out of range", ""],
    ]);
  });

  it("guards against CSV formula injection in the error message and original values", () => {
    const parsed: ParsedTable = {
      headers: ["Formula"],
      rows: [["=cmd|' /C calc'!A1"]],
      truncated: false,
    };
    const csv = buildErrorReportCsv(
      state([{ sourceRow: 2, message: "=SUM(A1:A2)" }]),
      parsed,
    );
    const result = parseCsvText(csv);
    expect(result.rows[0]?.[2]).toBe("'=SUM(A1:A2)");
    expect(result.rows[0]?.[3]).toBe("'=cmd|' /C calc'!A1");
  });
});

describe("createImportJobState with unchanged rows", () => {
  it("counts elided no-op rows as processed but not failed", () => {
    const state = createImportJobState(10, [{ sourceRow: 2, message: "x" }], 3);
    expect(state.processed).toBe(4);
    expect(state.failed).toBe(1);
  });
});
