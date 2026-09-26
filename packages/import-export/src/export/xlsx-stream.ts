/**
 * Node-side streaming XLSX export: rows are written and committed one at a
 * time, so memory stays flat for large exports. Browser code should use the
 * in-memory `buildXlsxBlob` instead.
 */
import type { PassThrough, Readable } from "node:stream";
import type ExcelJS from "exceljs";
import { assertNoHiddenColumns } from "../internal/access";
import { loadExcelJS } from "../internal/exceljs";
import { columnWidthChars, toExcelCell } from "./cells";
import { toAsyncIterable } from "./rows";
import type { ExportOptions } from "./types";
import { applyHeaderRow, sanitizeSheetName, writeExcelCell } from "./xlsx-shared";

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Rows written between event-loop yields (see writeRows). */
const YIELD_EVERY = 200;

/** Resolves when `pass` can take more data (or is gone), for backpressure. */
function drained(pass: PassThrough): Promise<void> {
  if (!pass.writableNeedDrain || pass.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pass.off("drain", done);
      pass.off("close", done);
      resolve();
    };
    pass.on("drain", done);
    pass.on("close", done);
  });
}

/**
 * Writes every row, then finalises the worksheet and the workbook.
 *
 * exceljs pushes bytes into `pass` only from later event-loop callbacks (the
 * zip/deflate step), so without an explicit yield the loop would read the
 * whole source before the consumer sees a byte and `writableNeedDrain` would
 * never become true. Yielding every YIELD_EVERY rows lets output flow, and
 * `drained` then applies real backpressure.
 */
async function writeRows(
  opts: ExportOptions,
  wb: ExcelJS.stream.xlsx.WorkbookWriter,
  ws: ExcelJS.Worksheet,
  pass: PassThrough,
): Promise<void> {
  const { columns, registry, rows, tz } = opts;
  let n = 0;
  for await (const row of toAsyncIterable(rows)) {
    if (pass.destroyed) return;
    const excelRow = ws.addRow([]);
    columns.forEach((column, i) => {
      writeExcelCell(
        excelRow.getCell(i + 1),
        toExcelCell(row.cells[column.key], column, registry, tz),
      );
    });
    excelRow.commit();
    n += 1;
    if (n % YIELD_EVERY === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Don't outrun a slow consumer: wait while the output buffer is full.
      await drained(pass);
      if (pass.destroyed) return;
    }
  }
  ws.commit();
  await wb.commit();
}

/**
 * XLSX export as a Node Readable. Access is checked before anything else; the
 * stream is returned at once and rows are pulled lazily from `opts.rows` in
 * the background. Any failure (a throwing row source, a conversion error)
 * destroys the stream with that error, so consumers see an 'error' event
 * instead of a hang. `node:stream` is imported dynamically so browser bundles
 * never include it.
 */
export async function buildXlsxStream(opts: ExportOptions): Promise<Readable> {
  const { columns, access, sheetName } = opts;
  assertNoHiddenColumns(columns, access);
  // Surface an invalid tz as a rejection now, not as a stream error later.
  new Intl.DateTimeFormat("en-US", { timeZone: opts.tz });

  const [{ PassThrough: PassThroughCtor }, ExcelJS] = await Promise.all([import("node:stream"), loadExcelJS()]);
  const pass: PassThrough = new PassThroughCtor();

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: pass,
    useStyles: true,
    useSharedStrings: false,
  });
  // The frozen pane and column widths are written with the sheet's opening
  // XML, so both must be set before the first row is committed.
  const ws = wb.addWorksheet(sanitizeSheetName(sheetName), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = columns.map((c) => ({
    header: c.label,
    key: c.id,
    width: columnWidthChars(c),
  }));
  const header = ws.getRow(1);
  applyHeaderRow(header);
  header.commit();

  writeRows(opts, wb, ws, pass).catch((err: unknown) => {
    pass.destroy(toError(err));
  });

  return pass;
}
