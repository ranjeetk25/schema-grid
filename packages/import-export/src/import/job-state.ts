/**
 * Pure tracking of an import job's progress, plus a downloadable CSV report
 * of the rows that failed.
 *
 * Everything here is pure: `recordChunkResult` never mutates its `state`
 * argument, always returning a new `ImportJobState`.
 */
import Papa from "papaparse";
import type { ChangeResult } from "../internal/core";
import { sanitizeCsvText } from "../internal/csv-guard";
import type { ImportJobState, ImportRowError, ParsedTable } from "./types";

/** One chunk of an import job's create/update work, as submitted to the server. */
export interface ImportChunk {
  kind: "create" | "update";
  /** Number of rows in this chunk (used to advance `processed`). */
  rowCount: number;
  /** Update chunks: rowId -> the 1-based spreadsheet row it came from. */
  sourceRowsByRowId?: Record<string, number>;
  /** Create chunks: the 1-based spreadsheet row for each created row, in order. */
  sourceRows?: number[];
}

/** Counts the distinct `sourceRow`s across `errors`. */
function distinctSourceRowCount(errors: ImportRowError[]): number {
  return new Set(errors.map((e) => e.sourceRow)).size;
}

/**
 * `sourceRowsByRowId` doesn't have every rowId when a rowId was never sent to
 * the server as part of a mapped chunk (this shouldn't normally happen, but we
 * fail soft rather than dropping the error). We report `sourceRow: 0` and
 * prefix the message with the row id so the row is still identifiable.
 */
function resolveSourceRow(
  rowId: string,
  sourceRowsByRowId: Record<string, number> | undefined,
  message: string,
): { sourceRow: number; message: string } {
  const sourceRow = sourceRowsByRowId?.[rowId];
  if (sourceRow !== undefined) return { sourceRow, message };
  return { sourceRow: 0, message: `[row ${rowId}] ${message}` };
}

/**
 * Initial job state. `initialErrors` (the plan's `rejected`) count as failed
 * and processed; `unchangedRows` (the plan's `unchangedSourceRows.length`)
 * count as processed, so progress reaches `total` = number of file rows.
 */
export function createImportJobState(
  total: number,
  initialErrors: ImportRowError[] = [],
  unchangedRows = 0,
): ImportJobState {
  const errors = [...initialErrors];
  const count = distinctSourceRowCount(errors);
  return { total, processed: count + unchangedRows, failed: count, errors };
}

export function recordChunkResult(
  state: ImportJobState,
  chunk: ImportChunk,
  result: ChangeResult | { error: string },
): ImportJobState {
  const newErrors: ImportRowError[] = [];

  if ("error" in result) {
    const sourceRows =
      chunk.kind === "create"
        ? (chunk.sourceRows ?? [])
        : Object.values(chunk.sourceRowsByRowId ?? {});
    for (const sourceRow of sourceRows) {
      newErrors.push({ sourceRow, message: result.error });
    }
  } else {
    for (const conflict of result.conflicts) {
      const { sourceRow, message } = resolveSourceRow(
        conflict.rowId,
        chunk.sourceRowsByRowId,
        "Changed by someone else since the import started",
      );
      newErrors.push({
        sourceRow,
        columnId: conflict.columnId,
        message,
      });
    }
    for (const error of result.errors) {
      const { sourceRow, message } = resolveSourceRow(
        error.rowId,
        chunk.sourceRowsByRowId,
        error.message,
      );
      newErrors.push({
        sourceRow,
        columnId: error.columnId,
        message,
      });
    }
  }

  const errors = [...state.errors, ...newErrors];
  return {
    total: state.total,
    processed: state.processed + chunk.rowCount,
    failed: distinctSourceRowCount(errors),
    errors,
  };
}


export function buildErrorReportCsv(
  state: ImportJobState,
  parsed?: ParsedTable,
): string {
  const fields = ["Row", "Column", "Error", ...(parsed?.headers ?? [])];
  const headerRow = parsed?.headerRow ?? 1;

  const data = state.errors.map((e) => {
    const row = [
      String(e.sourceRow),
      e.columnId ?? "",
      sanitizeCsvText(e.message),
    ];
    if (parsed) {
      const index = e.sourceRow - headerRow - 1;
      const original = index >= 0 ? parsed.rows[index] : undefined;
      for (let i = 0; i < parsed.headers.length; i++) {
        const value = original?.[i] ?? "";
        row.push(sanitizeCsvText(value));
      }
    }
    return row;
  });

  return `﻿${Papa.unparse({ fields, data }, { newline: "\r\n" })}`;
}
