/**
 * Browser-side XLSX export: builds the whole workbook in memory and returns a Blob.
 * For large Node exports use the streaming writer instead.
 */
import ExcelJS from "exceljs";
import { assertNoHiddenColumns } from "../internal/access";
import { columnWidthChars, toExcelCell } from "./cells";
import { toAsyncIterable } from "./rows";
import type { ExportOptions } from "./types";
import {
  XLSX_MIME,
  applyHeaderRow,
  sanitizeSheetName,
  writeExcelCell,
} from "./xlsx-shared";

export async function buildXlsxBlob(opts: ExportOptions): Promise<Blob> {
  const { columns, registry, rows, tz, access, sheetName } = opts;
  assertNoHiddenColumns(columns, access);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName(sheetName));
  ws.columns = columns.map((c) => ({
    header: c.label,
    key: c.id,
    width: columnWidthChars(c),
  }));
  applyHeaderRow(ws.getRow(1));
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for await (const row of toAsyncIterable(rows)) {
    const excelRow = ws.addRow([]);
    columns.forEach((column, i) => {
      const excelCell = toExcelCell(
        row.cells[column.key],
        column,
        registry,
        tz,
      );
      writeExcelCell(excelRow.getCell(i + 1), excelCell);
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}
