# @masai/schema-grid-io

CSV/XLSX import and export for Schema Grid, plus the TSV clipboard format used by
`@masai/schema-grid-ag-grid`. The package runs in the browser (for previews and small
exports) and in Node (for server import/export jobs).

## Entry points

| Subpath | Runs in | Heavy deps | Exports |
|---|---|---|---|
| `@masai/schema-grid-io/import` | browser + Node | papaparse, exceljs | `parseFile`, `autoMapColumns`, `validateRows`, `toChangeBatches`, `keyOf`, `chunkRows`, `createImportJobState`, `recordChunkResult`, `buildErrorReportCsv`, `SheetNotFoundError`, `ImportConfigError` |
| `@masai/schema-grid-io/export` | browser (Blob) + Node (stream) | papaparse, exceljs | `buildExport`, `buildExportBlob`, `buildExportStream`, `exportFileName`, `exportMimeType`, `HiddenColumnError` |
| `@masai/schema-grid-io/clipboard` | anywhere | **none** | `formatForClipboard`, `formatMatrixForClipboard`, `parseClipboard` |
| `@masai/schema-grid-io` | | | everything above |

`./clipboard` has no runtime dependencies, so the grid can import it without
pulling in exceljs or papaparse. `node:stream` is only loaded with a dynamic
`import()` on the Node stream paths, so browser bundles never include it.

## Import pipeline

Call these in order:

1. **`parseFile(input, { type?, sheet?, headerRow?, maxRows?, tz? })`** reads a `File`,
   `Blob`, `ArrayBuffer` or web `ReadableStream` into a `ParsedTable` of strings.
   - CSV: UTF-8 with the BOM removed; the delimiter (`,` `;` tab `|`) is detected.
   - XLSX: numbers use the raw value (not the display text), date-only cells become
     `YYYY-MM-DD`, datetimes become UTC ISO read in `tz`, formulas use their saved result.
   - Pass `maxRows` for a preview; `truncated` says whether more rows exist.
2. **`autoMapColumns(headers, schema, access)`** suggests a column for each header.
   Exact label/key matches get confidence 1; fuzzy or abbreviated matches score below 1.
   Only columns with `"edit"` access that aren't formulas are ever suggested.
3. **`validateRows(parsed, mapping, schema, registry, { mode, keyColumnId, unknownOptions, limit?, access? })`**
   runs every mapped cell through its field type's `parse`, checks required fields and
   keys, and applies the unknown-option policy (`"create"` collects labels in
   `summary.newOptions`; `"reject"` makes them cell errors). `summary.unknownOptions`
   lists every distinct unknown label per column under either policy, and each failed
   cell carries an `errorKind` (`"unknownOption"`, `"parse"` or `"required"`) next to its
   message. Mapping problems throw `ImportConfigError` before any row is read. In
   `update`/`upsert` the key column's type must be in `KEY_COLUMN_TYPES` (text, longText,
   email, phone or url).
4. **`toChangeBatches(report, existingRowsByKey, { schema, registry, mode, keyColumnId })`**
   returns an `ImportPlan`: flat `creates` (split them with `chunkRows`), update
   `ChangeBatch`es (`source: "import"`, at most 500 rows each), `rejected` rows, and
   `unchangedSourceRows` (rows identical to what is stored, which are left out).
5. On the server, create any `newOptions` first, send each chunk, and feed every result to
   **`recordChunkResult`** starting from **`createImportJobState(total, plan.rejected, plan.unchangedSourceRows.length)`**.
   **`buildErrorReportCsv(state, parsed)`** produces a downloadable CSV of the failed rows.

### `existingRowsByKey` must be built with `keyOf`

The server job runner must build the lookup map with the exported `keyOf(value, keyColumn, registry)`,
which is the field type's `format`, trimmed and lowercased. The same function is used for
duplicate-key detection in `validateRows` and for matching in `toChangeBatches`. If two stored
rows produce the same key, the server must report them instead of letting one overwrite the other.

## Export

`buildExport({ columns, registry, rows, format, tz, fileName, access, sheetName? })`
returns a `Blob` in the browser and a Node `Readable` in Node. `buildExportBlob` and
`buildExportStream` pick a path explicitly. `rows` can be an array or an `AsyncIterable`,
which the stream paths read lazily.

- XLSX cells are typed: numbers and currency are numbers with a number format, dates and
  datetimes are Excel dates (datetimes shown as clock time in `tz`), booleans are booleans,
  URLs are hyperlinks. The header row is bold and frozen; widths come from `ColumnDef.width`.
- CSV starts with a UTF-8 BOM and uses `\r\n`. Text that could run as a spreadsheet formula
  (starting with `=`, `+`, `-`, `@`, tab or CR/LF) gets a leading `'`. Numbers, dates, phone
  numbers and booleans are written unchanged.

### Access fails closed

Every export and `formatForClipboard(..., { access })` throws `HiddenColumnError` before
writing anything if any requested column is `"hidden"` **or missing from the access map**.
Pass only the columns the user can read.

### Timezones

Pass the **same `tz`** to export and to `parseFile`. XLSX has no timezones: export writes a
datetime as the clock time in `tz`, and import reads a clock time back as an instant in `tz`.

## Clipboard

`formatMatrixForClipboard` / `parseClipboard` use Excel's TSV rules: cells containing a tab,
newline or `"` are quoted, `""` is a literal quote, one trailing row break is dropped, and
ragged rows are padded. `formatForClipboard(rows, columns, registry)` formats each cell with
its field type's `format`.

## Core integration

Every core contract comes from `@masai/schema-grid-core` through one shim,
`src/internal/core.ts` (the only file allowed to import core). It imports **types only**,
so no core code is bundled into `./clipboard`.

Open item (`TODO(core)`): `getSelectOptions` reads `config.options` itself; replace it
with a core option accessor if core exports one.

Import applies its own unknown-option policy (`unknownOptions: "create" | "reject"`) to
select, creatableSelect and multiSelect columns, independent of each column's
`allowCreate` setting; other types' `pendingOptions` are honoured through the same policy.
