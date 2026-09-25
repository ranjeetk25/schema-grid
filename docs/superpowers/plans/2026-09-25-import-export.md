# @masai/schema-grid-io Implementation Plan

**REQUIRED SUB-SKILL:** superpowers:subagent-driven-development

**Goal:** Build `@masai/schema-grid-io` (`packages/import-export`). It reads CSV/XLSX files into a string table, maps file headers to schema columns automatically, validates rows using each field type's `parse`, turns validated rows into create and update batches for the server job runner, exports CSV/XLSX with real types while respecting column access, and provides the TSV clipboard format/parse used by the ag-grid package.

**Architecture:** The package works in both the browser and Node, with four entry points: `.` (re-exports everything), `./import`, `./export` and `./clipboard`. `./clipboard` has no dependencies at all, so ag-grid can import it without pulling in exceljs or papaparse.
- **Reading files:** every input is first turned into bytes. CSV is decoded as UTF-8 (BOM removed) and parsed with papaparse. XLSX is loaded into an in-memory exceljs `Workbook`, and each cell is converted to a string: numbers use the raw value, dates become ISO strings, formulas use their saved result.
- **Import steps:** auto-mapping, validation, change planning and job state are pure functions that depend only on core types.
- **Export:** one pure cell-conversion layer feeds three writers:
  - CSV (papaparse `unparse`, UTF-8 BOM),
  - in-memory XLSX (`Workbook` then `writeBuffer`, returned as a `Blob`), for the browser,
  - streaming XLSX (`stream.xlsx.WorkbookWriter` writing into a Node `PassThrough`), for Node.

  `buildExport` picks the browser or Node writer at runtime. The explicit `buildExportBlob` and `buildExportStream` can be called directly.
- **Core:** the package compiles against core's source through the `development` export condition. Every core symbol is imported through one shim file, `src/internal/core.ts`.

**Tech Stack:** TypeScript strict, bun workspaces, papaparse ^5.7, exceljs ^4.4 (ships its own types), tsup (ESM+CJS), Vitest 3 (node env by default; the Blob test opts into jsdom with a per-file environment comment), Biome (double quotes).

**Commands:** `bun run --filter @masai/schema-grid-io test`, `bun run --filter @masai/schema-grid-io typecheck`. Never run `check:fix` or `format` automatically.

**Library API facts (checked against context7):**
- **papaparse parse:** `Papa.parse(string, config)` with `delimiter: ""` auto-detects the delimiter; `delimitersToGuess` defaults to comma, tab, pipe, semicolon and two record separators. `preview` limits the number of rows parsed. `skipEmptyLines: "greedy"` is available. `meta.delimiter` reports the delimiter it found.
- **papaparse unparse:** `Papa.unparse({ fields, data }, { newline: "\r\n", header, quotes, escapeFormulae })`.
- **exceljs reading:** `new Workbook()` then `wb.xlsx.load(ArrayBuffer|Buffer)`.
- **exceljs cell values:**
  - a date is a JS `Date` whose UTC fields are the Excel clock time,
  - a formula is `{ formula, result }` (shared formulas are `{ sharedFormula, result }`),
  - a hyperlink is `{ text, hyperlink }`,
  - rich text is `{ richText: [{ text }] }`,
  - an error is `{ error }`.
- **exceljs writing:** `wb.xlsx.writeBuffer()` for the in-memory workbook.
- **exceljs streaming:** `new stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false })`, then `row.commit()`, `worksheet.commit()`, `workbook.commit()`. Column widths and frozen panes must be set before the first row is committed.
- **Freezing the header row:** `worksheet.views = [{ state: "frozen", ySplit: 1 }]`.

---

## Dependency graph

```
T1 scaffold/types/core shim/test helpers
 ├─► T2 clipboard                                  [parallel lane A]
 ├─► T3 tz helpers ─┬─► T11 export cell conversion ─┬─► T12 CSV export ─────┐   [lane B]
 │                  │                               └─► T13 XLSX in-memory ─┤
 ├─► T4 input + CSV parse ─► T5 XLSX parse + fixtures + parseFile ──────────┼─► T14 XLSX stream + buildExport + round-trip
 │        (T5 also needs T3)                                                │   [lane C feeds T14]
 ├─► T6 autoMapColumns                              [parallel lane D]       │
 └─► T7 validateRows base ─► T8 select/multi/limit ─► T9 toChangeBatches ─► T10 job state + error CSV   [lane E]
                                                                            │
all ───────────────────────────────────────────────────────────────────────► T15 packaging check + README
```

- **Can run in parallel after T1:** T2, T3, T4, T6, T7.
- **After T3:** T11 (T5 also needs T4).
- **After T11:** T12 and T13 in parallel.
- **T14:** needs T5, T12 and T13.
- **T15:** runs last.

---

## File structure

```
packages/import-export/
  package.json                     (modify: subpath exports + development condition, scripts)
  tsup.config.ts                   (new: entries index, import/index, export/index, clipboard/index)
  vitest.config.ts                 (new: node env, development condition, globalSetup)
  .gitignore                       (new: test/fixtures/generated/)
  README.md                        (T15)
  src/
    index.ts                       barrel: re-exports import, export, clipboard
    internal/
      core.ts                      core shim: re-exports core types/functions; local aliases + TODO(core) for missing ones;
                                   option lookup (getSelectOptions), parse-result normaliser (unwrapParse)
      tz.ts                        toZonedWallClock, fromZonedWallClock, isMidnightUtc
      bytes.ts                     readInputBytes, decodeUtf8 (BOM strip)
      access.ts                    assertNoHiddenColumns, isImportable
    import/
      index.ts                     barrel
      types.ts                     ParsedTable, ParseFileOptions, ColumnMapping, RowValidation, CellValidation,
                                   ValidationReport, ValidateRowsOptions, ImportPlan, ImportRowError, ImportJobState
      detect.ts                    detectFileType
      table.ts                     shapeTable (headerRow, blank/duplicate headers, padding, empty-row skip, maxRows)
      csv.ts                       parseCsvText
      xlsx.ts                      parseXlsxBytes, cellToString
      parse-file.ts                parseFile
      normalize.ts                 normalizeLabel, tokenize, levenshtein, isAbbreviation
      auto-map.ts                  autoMapColumns
      validate.ts                  validateRows
      options.ts                   matchOption, splitMulti (select/multiSelect handling)
      change-batches.ts            toChangeBatches, keyOf, chunkRows
      job-state.ts                 createImportJobState, recordChunkResult, buildErrorReportCsv
    export/
      index.ts                     barrel
      types.ts                     ExportOptions, ExportFormat, ExcelCell
      cells.ts                     toExcelCell, toCsvCell, columnWidthChars, sanitizeCsvText
      csv.ts                       buildCsvBlob, buildCsvStream
      xlsx-memory.ts               buildXlsxBlob
      xlsx-stream.ts               buildXlsxStream
      build-export.ts              buildExport, buildExportBlob, buildExportStream, exportFileName, exportMimeType, isBrowserRuntime
      rows.ts                      toAsyncIterable (GridRow[] | AsyncIterable<GridRow>)
    clipboard/
      index.ts                     formatMatrixForClipboard, formatForClipboard, parseClipboard
  test/
    global-setup.ts                runs fixtures/generate.ts once before tests
    helpers/
      registry.ts                  makeRegistry() → createDefaultRegistry() (or minimal fakes + TODO(core) if core not ready)
      schema.ts                    makeSchema(), makeAccess(), makeRow() — shared column fixture set
      streams.ts                   collect Node Readable / web ReadableStream to bytes
    fixtures/
      bom.csv                      committed: UTF-8 BOM + comma CSV
      semicolon.csv                committed: semicolon-delimited, decimal commas inside quoted cells
      quoted-newline.csv           committed: quoted cell with embedded newline and "" escape
      generate.ts                  builds generated/sample.xlsx via exceljs
      generated/                   gitignored output
    scaffold.test.ts
    clipboard.test.ts
    tz.test.ts
    parse-csv.test.ts
    parse-xlsx.test.ts
    auto-map.test.ts
    validate.test.ts
    validate-options.test.ts
    change-batches.test.ts
    job-state.test.ts
    export-cells.test.ts
    export-csv.test.ts
    export-xlsx-blob.test.ts       (jsdom environment via per-file environment comment)
    export-xlsx-stream.test.ts
    round-trip.test.ts
    exports.test.ts
```

**Shared test fixture schema** (`test/helpers/schema.ts`, used by all tasks):

| Column id | Key | Type | Notes |
|---|---|---|---|
| `c_name` | `name` | text | required |
| `c_email` | `email` | email | key column for update tests |
| `c_pay` | `paymentStatus` | select | label "Payment Status"; options Paid, Pending |
| `c_tags` | `tags` | multiSelect | options A, B, C |
| `c_stage` | `stage` | creatableSelect | |
| `c_amount` | `amount` | currency | INR, 2 decimals |
| `c_joined` | `joinedOn` | date | |
| `c_call` | `lastCall` | datetime | |
| `c_active` | `active` | boolean | |
| `c_site` | `website` | url | |
| `c_owner` | `owner` | user | |
| `c_score` | `score` | formula | |
| `c_secret` | `secret` | text | access "hidden" |
| `c_note` | `note` | text | access "read" |

`makeAccess()` returns a `Map<columnId, Access>` where every other column has access "edit".

---

## Task 1: Scaffold, public types, core shim, test helpers

**Goal:** Set up a package that builds and tests green, with four subpath entry points, every public type declared, and a single file through which all core imports pass.

**Files:**
- Modify `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/package.json`:
  - `exports` for `.`, `./import`, `./export`, `./clipboard`. Each has conditions `development` (points at `./src/.../index.ts`), `types`, `import`, `require` (the last three point at `dist`).
  - Keep `sideEffects: false`.
  - Add `"typesVersions"` so `./import`, `./export` and `./clipboard` resolve under older TypeScript module resolution.
- New files, all under `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/`:
  - `tsup.config.ts`: 4 entries, ESM+CJS, dts, `external: ["exceljs", "papaparse", "@masai/schema-grid-core", "node:stream"]`.
  - `vitest.config.ts`:
    - environment `node`, include `test/**/*.test.ts`, `globalSetup: ["test/global-setup.ts"]`;
    - add `"development"` to both `resolve.conditions` and `ssr.resolve.conditions`. On Vite 6, spread `defaultClientConditions` / `defaultServerConditions` so the default conditions are not lost.
  - `.gitignore` containing `test/fixtures/generated/`.
  - `src/index.ts`, `src/import/index.ts`, `src/export/index.ts`, `src/clipboard/index.ts`: empty barrels.
  - `src/import/types.ts`, `src/export/types.ts`.
  - `src/internal/core.ts`.
  - `test/global-setup.ts`: calls nothing yet; wired to `fixtures/generate.ts` in T5.
  - `test/helpers/registry.ts`, `test/helpers/schema.ts`, `test/helpers/streams.ts`.
  - Test file: `test/scaffold.test.ts`.

**Public API (types only in this task):**
- **Import types:**
  - `ParsedTable { headers: string[]; rows: string[][]; sheetNames?: string[]; truncated: boolean; delimiter?: string }`
  - `ParseFileOptions { type?: "csv" | "xlsx"; sheet?: string | number; headerRow?: number (default 1); maxRows?: number; tz?: string (default "UTC"; used to turn XLSX clock-time datetimes into UTC instants) }`
  - `ColumnMapping { header: string; headerIndex: number; columnId: string | null; confidence: number }`
  - `CellValidation { value: unknown; raw: string; error?: string }`
  - `RowValidation { index: number (0-based index into ParsedTable.rows); sourceRow: number (1-based spreadsheet row number); cells: Record<columnId, CellValidation>; rowError?: string }`
  - `ValidationReport { rows: RowValidation[]; summary: { valid: number; invalid: number; newOptions: Record<columnId, string[]>; unmappedRequired: string[] } }`
  - `ValidateRowsOptions { mode: "create" | "update" | "upsert"; keyColumnId?: string; unknownOptions: "create" | "reject"; limit?: number; access?: ReadonlyMap<string, Access> }`
  - `ImportRowError { sourceRow: number; columnId?: string; message: string; raw?: string[] }`
  - `ImportPlan { creates: Partial<GridRow>[]; updates: ChangeBatch[]; rejected: ImportRowError[]; createSourceRows: number[]; updateSourceRows: Record<rowId, number> }`
  - `ImportJobState { total: number; processed: number; failed: number; errors: ImportRowError[] }`
- **Export types:**
  - `ExportFormat = "csv" | "xlsx"`
  - `ExportOptions { columns: ColumnDef[]; registry: FieldTypeRegistry; rows: AsyncIterable<GridRow> | GridRow[]; format: ExportFormat; tz: string; fileName: string; access: ReadonlyMap<string, Access>; sheetName?: string }`
  - `ExcelCell { value: string | number | boolean | Date | { text: string; hyperlink: string } | null; numFmt?: string }`
- **Core shim (`src/internal/core.ts`):**
  - Re-exports `ColumnDef`, `GridSchema`, `GridRow`, `ChangeBatch`, `CellChange`, `ChangeResult`, `FieldType`, `FieldTypeRegistry`, `ParseResult`, `Access` from `@masai/schema-grid-core`.
  - If any of these is not exported yet, declare a local type alias that matches spec section 4, marked with a `TODO(core): replace with core export` comment.
  - `unwrapParse(result: ParseResult<unknown>)` returns `{ ok: true; value } | { ok: false; error: string }`, so it doesn't matter exactly how core shapes its parse result.
  - `getSelectOptions(column: ColumnDef)` returns `{ value: string; label: string }[]`. It reads `config.options` defensively and carries a `TODO(core)` until core exports an option accessor.
- **Test helpers:**
  - `makeRegistry()`: `createDefaultRegistry()` from core. If core's registry isn't ready, register minimal fakes (text, email, number, currency, boolean, date, datetime, select, multiSelect, creatableSelect, user, url, formula) with a `TODO(core)`.
  - `makeSchema()`, `makeAccess()`, `makeRow(cells, overrides)`: build the shared fixture schema, access map and rows.

**TDD (test/scaffold.test.ts), write failing tests first, then implement:**
- Importing `src/index.ts`, `src/import/index.ts`, `src/export/index.ts` and `src/clipboard/index.ts` succeeds.
- `unwrapParse` returns ok/value for a successful core parse and ok false/error for a failing one (use `makeRegistry().get("number")` with "abc").
- `getSelectOptions` returns Paid and Pending for `c_pay`, and an empty list for the text column.
- `makeSchema()` includes the hidden `c_secret` and the formula `c_score`, and `makeAccess().get("c_secret")` is "hidden".
- `typecheck` passes with `development` resolving to core's `src`.

**Commit:** `chore(io): scaffold schema-grid-io package with subpath exports, types and core shim`

---

## Task 2: Clipboard TSV format/parse

**Goal:** Copy and paste use the same rules everywhere. Cells containing a tab, newline or double quote are wrapped in quotes, and the parser reads them back correctly. The module has no dependencies.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/clipboard/index.ts`, `src/internal/access.ts`; test `test/clipboard.test.ts`.

**Public API:**
- `formatMatrixForClipboard(matrix: string[][]): string`
  - Cells are separated by tabs and rows by `\r\n`, with no trailing newline.
  - A cell is wrapped in double quotes only if it contains a tab, `\r`, `\n` or `"`, and any `"` inside is doubled.
- `formatForClipboard(rows: GridRow[], columns: ColumnDef[], registry: FieldTypeRegistry, opts?: { access?: ReadonlyMap<string, Access>; includeHeaders?: boolean }): string`
  - Each cell is the field type's `format(row.cells[column.key], column.config)`; empty values become "".
  - If `access` is given, it calls `assertNoHiddenColumns` first.
- `parseClipboard(text: string): string[][]`
  - A small hand-written state machine.
  - Accepts `\r\n`, `\n` and `\r` as row breaks.
  - A quote only starts a quoted cell when it is the first character of the cell. Inside quotes, `""` means one literal `"`.
  - A cell with an opening quote that is never closed is re-read as plain text.
  - One trailing row break (Excel adds one) is dropped.
  - Rows are padded with "" up to the widest row, so the result is rectangular.
- `assertNoHiddenColumns(columns, access)` (internal, in `src/internal/access.ts`):
  - Throws `HiddenColumnError` (exported from `.`), with `columnIds` listing the offending columns, when any column's access is "hidden" or missing from the map (fail-closed).

**TDD cases:**
- A cell `line1\nline2` with an embedded quote survives `formatMatrixForClipboard` then `parseClipboard` unchanged (acceptance: quoted newline cell survives the round trip).
- Excel-style input with a trailing `\r\n` does not produce an extra empty row.
- A tab inside a quoted cell stays inside that cell.
- `a"b` (quote in the middle of a cell) is taken literally.
- An unclosed quote comes back as literal text instead of swallowing the following rows.
- Ragged rows are padded to be rectangular.
- `formatForClipboard` uses the field type's `format` (the select shows its label; a boolean is formatted by its type).
- `formatForClipboard` with an access map that includes `c_secret` throws `HiddenColumnError`.

**Commit:** `feat(io): clipboard TSV format and RFC-style parse with quoted multiline cells`

---

## Task 3: Timezone helpers

**Goal:** Pure, dependency-free conversion between UTC instants and "clock time in a timezone", used by both XLSX import and export.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/internal/tz.ts`; test `test/tz.test.ts`.

**API (internal):**
- `toZonedWallClock(instant: Date | string, tz: string): Date`
  - Returns a `Date` whose UTC fields equal the clock time in `tz`. This is the form Excel expects.
  - Implemented with `Intl.DateTimeFormat(..., { timeZone, hourCycle: "h23" }).formatToParts`.
- `fromZonedWallClock(wall: Date, tz: string): string`
  - The inverse: reads the UTC fields as a clock time in `tz` and returns an ISO UTC instant string.
  - Uses a two-pass offset correction so it stays correct around daylight-saving changes.
- `isMidnightUtc(d: Date): boolean`.
- `toIsoDate(d: Date): string`: `YYYY-MM-DD` from the UTC fields.

**TDD cases:**
- `2026-09-24T18:30:00Z` in `Asia/Kolkata` gives a clock time of 2026-09-25 00:00.
- `fromZonedWallClock` inverts `toZonedWallClock` for Kolkata, UTC and `America/New_York` (including an instant in the DST-transition week).
- `isMidnightUtc` is true for a clock-time date with no time part.
- An invalid tz throws `RangeError` (surfaced to callers, not swallowed).

**Commit:** `feat(io): wall-clock timezone helpers for Excel date conversion`

---

## Task 4: Input reading, file-type detection, CSV parsing, table shaping

**Goal:** Turn any supported input into a `ParsedTable` for CSV, with the delimiter detected and the BOM stripped. Build the shared table-shaping step that XLSX will reuse.

**Files:** under `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/`:
- `src/internal/bytes.ts`, `src/import/detect.ts`, `src/import/table.ts`, `src/import/csv.ts`.
- Committed fixtures `test/fixtures/bom.csv`, `test/fixtures/semicolon.csv`, `test/fixtures/quoted-newline.csv`.
- Test `test/parse-csv.test.ts`.

**API:**
- `readInputBytes(input: File | Blob | ArrayBuffer | ReadableStream<Uint8Array>): Promise<Uint8Array>`
  - Blob/File: use `arrayBuffer()` when available, otherwise fall back to `FileReader` (older jsdom).
  - Web ReadableStream: read through its reader.
- `decodeUtf8(bytes): string`: `TextDecoder("utf-8")`, which removes the BOM by default. As a safety net, any leading `\uFEFF` still present is removed.
- `detectFileType(input, bytes, hint?): "csv" | "xlsx"`
  - The explicit `hint` wins.
  - Otherwise use the `File.name` extension (`.xlsx`/`.xlsm` means xlsx; `.csv`/`.tsv`/`.txt` means csv).
  - Otherwise, bytes starting with the zip signature `PK\x03\x04` mean xlsx; anything else is csv.
- `parseCsvText(text, opts): ParsedTable`
  - Calls `Papa.parse` with `delimiter: ""` (auto-detect) and `skipEmptyLines: "greedy"`.
  - When `maxRows` is set, uses `preview: headerRow + maxRows + 1` so it can tell whether the file was truncated.
  - Hands the parsed rows to `shapeTable`, and records `meta.delimiter` on `ParsedTable.delimiter`.
- `shapeTable(matrix: string[][], opts: { headerRow; maxRows? }): ParsedTable`
  - Rows above `headerRow` are dropped.
  - Headers are trimmed. A blank header becomes `Column N`, and a repeated header becomes `Name (2)`.
  - Data rows are padded or cut to the header width.
  - Rows where every cell is blank are skipped.
  - `truncated` is true when more than `maxRows` data rows exist.

**TDD cases:**
- `bom.csv`: the first header has no `\uFEFF` (acceptance: BOM stripped).
- `semicolon.csv`: `delimiter` is ";", and the quoted `1,5` stays a single cell (acceptance: semicolon CSV detected).
- `quoted-newline.csv`: the cell contains `\n`, and the row count is correct.
- With `headerRow: 2`, the first line is ignored and the headers come from line 2.
- Duplicate and blank headers are renamed as described.
- With `maxRows: 2` on a 5-row file, 2 rows are returned and `truncated` is true. With exactly 2 rows, `truncated` is false.
- `readInputBytes` returns the same bytes for an ArrayBuffer, a Blob and a web ReadableStream.
- `detectFileType` recognises the zip signature as xlsx, and an explicit hint overrides it.

**Commit:** `feat(io): CSV parsing with delimiter detection, BOM strip and table shaping`

---

## Task 5: XLSX parsing, fixture generator, parseFile

**Goal:** Read XLSX with exceljs into strings: numbers from the raw value, dates as ISO strings, formulas as their saved result. Then provide the single entry point `parseFile`.

**Files:** under `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/`:
- `src/import/xlsx.ts`, `src/import/parse-file.ts`.
- `test/fixtures/generate.ts` (and wire `test/global-setup.ts` to it).
- Test `test/parse-xlsx.test.ts`.

**Fixture generator (`generate.ts`):** writes `test/fixtures/generated/sample.xlsx` with exceljs. It has two sheets.
- Sheet "Leads" (header on row 1) has one cell of each kind:
  - the number 1234.5 displayed with format `#,##0.00`,
  - the float 0.1+0.2,
  - a date-only 2026-09-25,
  - the datetime 2026-09-25 10:30 (with a `yyyy-mm-dd hh:mm` format),
  - a boolean,
  - the formula `A2*2` with saved result 2469,
  - a hyperlink `{ text, hyperlink }`,
  - a rich text cell,
  - an error cell `#N/A`,
  - a blank cell.
- Sheet "Offset" has a title on row 1 and headers on row 2.

**API:**
- `cellToString(value, numFmt: string | undefined, tz: string): string`
  - `null`/`undefined`: "".
  - number: `String(Number(n.toPrecision(15)))`. This uses the raw value, never the display text, and removes floating-point noise.
  - boolean: "TRUE"/"FALSE".
  - Date:
    - date-only when `numFmt` has no time tokens (h, s, AM/PM) and `isMidnightUtc`: result is `toIsoDate`.
    - otherwise: result is `fromZonedWallClock(value, tz)`.
  - formula / shared formula: `cellToString(result)` recursively.
  - hyperlink: the `hyperlink` URL when present, otherwise `text`.
  - rich text: the joined segment texts.
  - error: "".
  - string: unchanged.
- `parseXlsxBytes(bytes, opts): Promise<ParsedTable>`
  - Loads with `new Workbook().xlsx.load(bytes)`.
  - Chooses the sheet by name, then by 1-based index, defaulting to the first sheet. An unknown sheet throws `SheetNotFoundError` listing the sheet names.
  - Reads rows up to `headerRow + maxRows + 1` without allocating beyond that, then hands them to `shapeTable`.
  - Sets `sheetNames` to every worksheet name.
  - The 1904 date system needs no special handling because exceljs already returns JS Dates.
- `parseFile(input, opts?: ParseFileOptions): Promise<ParsedTable>`
  - Runs `readInputBytes`, then `detectFileType`, then either `parseCsvText(decodeUtf8(bytes))` or `parseXlsxBytes`.

**TDD cases:**
- The date-only cell becomes `2026-09-25` (acceptance: XLSX date cell becomes ISO).
- The datetime cell with `tz: "Asia/Kolkata"` becomes `2026-09-25T05:00:00.000Z`. With the default tz ("UTC") it becomes `2026-09-25T10:30:00.000Z`.
- The number with a thousands display format becomes "1234.5" (raw, not "1,234.50").
- 0.1+0.2 becomes "0.3".
- The formula cell becomes "2469".
- The hyperlink cell gives its URL, rich text gives the plain joined text, and the error cell gives "".
- `sheetNames` equals ["Leads", "Offset"]. `sheet: "Offset", headerRow: 2` returns the correct headers. `sheet: "Nope"` throws `SheetNotFoundError`.
- `parseFile` called with a `File` named `x.csv` and with the XLSX `ArrayBuffer` sends each to the right parser. `maxRows` truncation works for XLSX.

**Commit:** `feat(io): XLSX parsing via exceljs and unified parseFile`

---

## Task 6: autoMapColumns

**Goal:** Suggest a schema column for each file header. Exact matches get confidence 1.0 and fuzzy matches less than 1.0. Hidden, read-only and formula columns are never suggested.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/import/normalize.ts`, `src/import/auto-map.ts`; test `test/auto-map.test.ts`.

**API:**
- `normalizeLabel(s): string`: lowercase, remove accents (NFKD), and keep only letters and digits (Unicode `\p{L}\p{N}`).
- `tokenize(s): string[]`: split on camelCase boundaries, whitespace, punctuation, and letter/digit changes, then lowercase.
- `levenshtein(a, b, max?): number`: Levenshtein edit distance, stopping early once it exceeds `max`.
- `isAbbreviation(short, long): boolean`: `short.length >= 3`, same first letter, and the letters of `short` appear in order inside `long`.
- `autoMapColumns(headers: string[], schema: GridSchema | ColumnDef[], access: ReadonlyMap<string, Access>, opts?: { minConfidence?: number (default 0.6) }): ColumnMapping[]`
  - **Candidate columns:** access is "edit" and type is not "formula". Columns with access "hidden" or "read", or missing from the map, are never candidates.
  - **Scoring each header against each candidate:**
    - **1.0:** the normalised header equals the normalised label or the normalised key.
    - **Whole-string fuzzy:** if the Levenshtein distance d on the normalised strings is at most 2 and the shorter string has at least 4 characters, the score is `0.95 * (1 - d / maxLen)`.
    - **Word by word:** each header word is paired with a word from the label or key when they are equal (1), within Levenshtein distance 1 (0.9), or an abbreviation (0.8). The score is the average of the best pairs times the share of words that found a match, capped at 0.9.
    - The best of these scores is used.
  - **Assignment:** one header per column. The highest confidence wins; on a tie, the earlier header wins.
  - A header left unassigned, or scoring below `minConfidence`, gets `columnId: null, confidence: 0`.
  - The output keeps the header order and includes `headerIndex`.
  - **Design note for the reviewer:** "Pymt Status" vs `paymentStatus` has an edit distance of 3 after normalising, so the spec's "Levenshtein ≤ 2" rule alone cannot pass the acceptance case. That is why word-by-word matching and abbreviations were added.

**TDD cases:**
- "Payment Status" maps to `c_pay` with confidence exactly 1.0 (acceptance).
- "payment_status" and "PAYMENT-STATUS" also give 1.0 (normalised key match).
- "Pymt Status" maps to `c_pay` with confidence strictly between 0.6 and 1 (acceptance: fuzzy below 1.0).
- "Emial" maps to `c_email` through whole-string Levenshtein, with confidence below 1.
- "Secret" never maps to `c_secret` (hidden), even though it is an exact match (acceptance).
- "Note" never maps to `c_note` (read-only). "Score" never maps to `c_score` (formula).
- Two headers competing for the same column: only the higher one is mapped; the other gets null.
- An unrelated header "Zzz" gets null with confidence 0.
- Accepts either a `GridSchema` or a `ColumnDef[]`.

**Commit:** `feat(io): autoMapColumns with normalized, fuzzy and abbreviation matching`

---

## Task 7: validateRows (base)

**Goal:** Run each mapped cell through its field type's `parse`, and check required fields and the key column. The result is a per-row, per-column report.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/import/validate.ts`, `src/internal/access.ts` (add `isImportable`); test `test/validate.test.ts`.

**API:**
- `validateRows(parsed: ParsedTable, mapping: ColumnMapping[], schema: GridSchema | ColumnDef[], registry: FieldTypeRegistry, opts: ValidateRowsOptions): ValidationReport`
- **Setup errors** throw `ImportConfigError` before any row is processed, when:
  - a mapping points to an unknown column,
  - a formula column is mapped,
  - two headers are mapped to the same column,
  - `mode` is update or upsert and `keyColumnId` is missing or not mapped,
  - `opts.access` is given and a mapped column other than the key isn't editable, or the key column is hidden.
- **For each row and each mapped column:**
  - The raw string is trimmed.
  - Empty cell: value is `null` and nothing is parsed. In update mode an empty cell means "leave unchanged" and is marked so later steps skip it (flag it on `CellValidation` as `skip: true`).
  - Non-empty cell: `unwrapParse(type.parse(raw, column.config))`. Success gives `value`; failure sets `error` to the parse message.
- **Required check:** in create mode, and in upsert mode for rows without a key, an empty required column gives the cell error "Required".
- **Key check (update/upsert):** an empty key sets `rowError` to "Missing key" in update mode. In upsert mode it is allowed and later treated as a create. A key repeated within the file sets `rowError` to "Duplicate key (first seen on row N)" on the later rows.
- `summary.unmappedRequired`: required columns with edit access that aren't mapped, only in create/upsert modes.
- `summary.valid` / `summary.invalid`: a row is invalid if it has a `rowError` or any cell error.
- `sourceRow` = `headerRow + index + 1`.

**TDD cases:**
- The number column given "abc" gets a cell error. Given "12.5", its value comes from the core parse.
- In create mode, an empty required name gives "Required". In update mode the same row has no required error and the cell is marked skip.
- Update mode without `keyColumnId` throws `ImportConfigError`.
- An update row with an empty key gets `rowError` "Missing key".
- Upsert with an empty key is valid.
- A repeated key sets `rowError` on the second occurrence.
- Mapping to `c_score` throws. Mapping to `c_note` with `access` given throws.
- `unmappedRequired` lists `c_name` when name isn't mapped in create mode.
- The summary counts add up to the number of rows.

**Commit:** `feat(io): validateRows with field-type parse, required and key checks`

---

## Task 8: validateRows options (select, multiSelect, limit)

**Goal:** Handle unknown select option values according to the `unknownOptions` policy, split multiSelect cells, and support validating only the first N rows for previews.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/import/options.ts`, modify `src/import/validate.ts`; test `test/validate-options.test.ts`.

**API:**
- `matchOption(raw: string, options: { value; label }[]): { value; label } | null`: case- and whitespace-insensitive match on the label, then on the value.
- `splitMulti(raw: string): string[]`: split on `,` or `;`, trim each piece, drop empty pieces, and remove duplicates without regard to case while keeping the first spelling.
- **Changes inside `validateRows`:**
  - **select / creatableSelect:**
    - A known option is parsed using the option's canonical value.
    - An unknown value under "create" is added to `summary.newOptions[columnId]` (no duplicates, first spelling kept), and the cell value is the raw label so the job runner can create the option first.
    - An unknown value under "reject" gives the cell error `Unknown option "X"`.
  - **multiSelect:** `splitMulti`, then each piece is matched the same way. The value is the list of canonical values plus any new labels (under "create"). Under "reject", any unknown piece gives one cell error listing all the unknown pieces.
  - **limit:** only the first `limit` rows are validated. The summary counts only those rows.

**TDD cases:**
- `c_pay` "Refunded" with "create" is valid, and `newOptions.c_pay` equals ["Refunded"] (acceptance).
- The same row with "reject" gets the cell error and counts as invalid (acceptance).
- "paid" (different letter case) matches Paid with no new option.
- `c_tags` "A; b, C,,A" gives [A, B, C] in order (acceptance: multiSelect split).
- `c_tags` "A, Z" with "create" adds Z to `newOptions.c_tags`. With "reject" it gives an error naming Z.
- `c_stage` (creatableSelect) follows the same policy.
- "Refunded" appearing in 3 rows is listed once in `newOptions`.
- `limit: 2` on 10 rows returns 2 rows.

**Commit:** `feat(io): unknown-option policy, multiSelect splitting and preview limit`

---

## Task 9: toChangeBatches

**Goal:** Turn valid rows into create payloads and update `ChangeBatch`es for the server job runner, split into batches of 500 rows by default.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/import/change-batches.ts`; test `test/change-batches.test.ts`.

**API:**
- `keyOf(value: unknown, column: ColumnDef, registry): string`: the field type's `format`, trimmed and lowercased. The server must use this same function to build `existingRowsByKey`, so exported both ways.
- `chunkRows<T>(items: T[], size = 500): T[][]`.
- `toChangeBatches(report, existingRowsByKey: ReadonlyMap<string, GridRow>, opts: { schema: GridSchema | ColumnDef[]; registry; mode; keyColumnId?; chunkSize?: number (default 500); idFactory?: () => string (default `globalThis.crypto.randomUUID`) }): ImportPlan`
  - Invalid rows go into `rejected` as `ImportRowError`, one per cell error plus one for `rowError`.
  - **create:** each valid row becomes `Partial<GridRow>` with `cells` keyed by `column.key` (not `columnId`). Empty non-skipped cells are included as `null`.
  - **update:** the row's key is looked up with `keyOf`.
    - Not found: goes to `rejected` as "No existing row for key".
    - Found: one `CellChange` per non-skipped cell whose serialised value differs from `existing.cells[column.key]`, with `prev` set to the existing value. Rows with no changes are left out.
  - **upsert:** a found key is handled as an update. A missing or empty key is handled as a create.
  - Updates are grouped into `ChangeBatch { id: idFactory(), changes, baseVersions: { [rowId]: row.version }, source: "import" }`, with at most `chunkSize` distinct rows per batch.
  - `creates` is one flat list, as in the spec's signature. The job runner splits it with `chunkRows`.
  - `createSourceRows` and `updateSourceRows` record where each item came from, so errors can be reported against the original spreadsheet row.

**TDD cases:**
- 1201 valid update rows give 3 batches of 500, 500 and 201 rows (acceptance: chunking at 500). `chunkRows` on 1201 creates also gives 500, 500 and 201.
- `chunkSize: 2` is honoured.
- In create mode, `cells` uses `paymentStatus`, not `c_pay`.
- An update identical to the existing row produces no change, and the row is left out.
- An update changing one column produces a single `CellChange` with the correct `prev`/`next`, and `baseVersions` holds the row's version.
- In update mode an unknown key goes to `rejected`. In upsert mode the same row is created.
- Invalid rows go to `rejected` with `sourceRow` and `columnId`.
- `keyOf` matches regardless of letter case and surrounding whitespace.
- The source of every `ChangeBatch` is "import".

**Commit:** `feat(io): toChangeBatches with key matching, no-op elision and 500-row chunking`

---

## Task 10: Import job state and error report

**Goal:** Pure tracking of an import job's progress, plus a downloadable CSV of the rows that failed.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/import/job-state.ts`; test `test/job-state.test.ts`.

**API:**
- `createImportJobState(total: number, initialErrors?: ImportRowError[]): ImportJobState`: records `rejected` from the plan as already failed and processed.
- `recordChunkResult(state, chunk: { kind: "create" | "update"; rowCount: number; sourceRowsByRowId?: Record<string, number>; sourceRows?: number[] }, result: ChangeResult | { error: string }): ImportJobState`
  - Returns a new state; the input state is not modified.
  - Each `ChangeResult.errors` and `conflicts` entry is turned into an `ImportRowError` using the source-row map. Conflicts get the message "Changed by someone else since the import started".
  - If the whole chunk failed, every row in it gets the chunk error.
  - `processed += rowCount`, and `failed` counts distinct failing source rows.
- `buildErrorReportCsv(state: ImportJobState, parsed?: ParsedTable): string`
  - The columns are "Row", "Column", "Error", followed by the original headers when `parsed` is supplied, with that row's original values.
  - Starts with a UTF-8 BOM, uses `\r\n` line endings, and is built with `Papa.unparse`.

**TDD cases:**
- The state after `createImportJobState` with 2 rejected rows is processed 2, failed 2.
- A chunk with 1 conflict and 1 error out of 500 rows adds 500 to processed and 2 to failed.
- A whole-chunk failure marks every row in the chunk.
- The input state is not changed.
- The error CSV starts with `\uFEFF`, has the header "Row,Column,Error", and a message containing a comma or newline is quoted correctly (checked by parsing it back with `parseCsvText`).
- With `parsed` supplied, the original row values are appended.

**Commit:** `feat(io): import job state reducer and error report CSV`

---

## Task 11: Export cell conversion and access check

**Goal:** Pure conversion from a stored value to an Excel cell or CSV text, with every type rule in one place, plus a fail-closed check against exporting hidden columns.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/export/cells.ts`, `src/export/rows.ts`, `src/internal/access.ts` (reuse `assertNoHiddenColumns` from T2); test `test/export-cells.test.ts`.

**API:**
- `toExcelCell(value: unknown, column: ColumnDef, registry, tz: string): ExcelCell`
  - **null or empty:** `null`.
  - **number / currency:** a JS number. `numFmt` is `#,##0.##` for number (or the decimals from its config). For currency it is the currency symbol plus `#,##0.00`, taken from its config through the shim (`TODO(core)` if the config shape isn't settled).
  - **date:** `Date.UTC(y, m, d)` taken from the ISO date, with `numFmt` "yyyy-mm-dd".
  - **datetime:** `toZonedWallClock(value, tz)` with `numFmt` "yyyy-mm-dd hh:mm".
  - **boolean:** a JS boolean, which Excel shows as TRUE/FALSE.
  - **select / creatableSelect / user / email / phone / text / longText / link / custom:** the field type's `format` string.
  - **multiSelect:** each element's option label (via `getSelectOptions`, falling back to the raw value), joined with ", ".
  - **url:** `{ text: formatted, hyperlink: value }`.
  - **formula:** the stored value by its JS type (number → numeric, boolean → boolean, ISO datetime string → converted like datetime, otherwise string).
- `toCsvCell(value, column, registry): string`
  - The field type's `format`; multiSelect is joined with ", ".
  - The result goes through `sanitizeCsvText` for text-like types only (not number, currency, date, datetime, boolean or phone).
- `sanitizeCsvText(s)`: puts `'` in front of values starting with `=`, `+`, `-`, `@`, tab or CR. This stops a spreadsheet from running exported text as a formula, while leaving numeric and phone columns untouched.
- `columnWidthChars(column)`: `ColumnDef.width` in pixels divided by 7, rounded and clamped to the range 8–80. Defaults to 15.
- `toAsyncIterable(rows)`: turns an array or an async iterable into an async iterable.
- `assertNoHiddenColumns` is reused and throws `HiddenColumnError`.

**TDD cases:**
- Currency 1234.5 becomes the number 1234.5 with a `numFmt` containing `0.00`.
- Date "2026-09-25" becomes a Date whose UTC fields are 2026-09-25.
- Datetime `2026-09-25T05:00:00Z` with Kolkata becomes a clock time of 10:30.
- Boolean true becomes true.
- Select Paid becomes the label text. multiSelect [A, B] becomes "A, B". url becomes an object with `hyperlink`. formula 42 becomes the number 42.
- A text value "=HYPERLINK(...)" gets a leading `'` in CSV. A number "-5" and a phone "+91..." are unchanged.
- `columnWidthChars` with width 140 gives 20; with no width it gives 15.
- `assertNoHiddenColumns` with `c_secret`, or with a column missing from the access map, throws `HiddenColumnError`.

**Commit:** `feat(io): typed export cell conversion, CSV injection guard and hidden-column assertion`

---

## Task 12: CSV export (Blob and Node stream)

**Goal:** CSV export that opens correctly in Excel, as a Blob for the browser or a Node Readable for server jobs.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/export/csv.ts`; test `test/export-csv.test.ts`.

**API:**
- `buildCsvBlob(opts: ExportOptions): Promise<Blob>`
  - Checks access first.
  - The header row is the column labels. Rows are converted with `toCsvCell` and written with `Papa.unparse({ fields, data }, { newline: "\r\n" })` 500 rows at a time. Only the first chunk includes the header.
  - The result is `\uFEFF` plus the chunks, with type `text/csv;charset=utf-8`.
- `buildCsvStream(opts): Promise<Readable>`: same content, produced with `Readable.from` over an async generator, and pulls rows lazily from an `AsyncIterable`. `node:stream` is loaded by dynamic import only on this path, so browser bundles never include it.

**TDD cases:**
- The Blob text starts with a BOM, and its header equals the labels.
- A cell with a newline is quoted, and `parseCsvText` of the output gives the same matrix back.
- The stream version gives bytes identical to the Blob version for the same input.
- An async iterable of 1200 rows is read lazily: the generator is not run to completion before the first chunk comes out.
- A hidden column throws before any output is produced (acceptance: hidden column in export throws).

**Commit:** `feat(io): CSV export as Blob and Node stream with BOM`

---

## Task 13: In-memory XLSX export (browser Blob)

**Goal:** Browser-side XLSX export using an in-memory workbook: typed cells, bold frozen header row, and column widths.

**Files:** `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/src/export/xlsx-memory.ts`; test `test/export-xlsx-blob.test.ts` (with a jsdom environment comment at the top).

**API:**
- `buildXlsxBlob(opts: ExportOptions): Promise<Blob>`
  - Checks access, then `new Workbook()` and `addWorksheet(sheetName ?? "Export")`.
  - `worksheet.columns` gets `{ header: label, key: column.id, width: columnWidthChars }` for each column.
  - The header row font is bold, and `worksheet.views` freezes the first row.
  - Each row goes through `toExcelCell`, and `cell.numFmt` is set when there is a format.
  - `wb.xlsx.writeBuffer()` is returned as a `Blob` with the XLSX MIME type.

**TDD cases (jsdom):**
- The result is a `Blob` with the XLSX MIME type (acceptance: jsdom Blob path).
- Loading the Blob bytes back with exceljs shows:
  - a bold header,
  - `views[0]` frozen with `ySplit` 1,
  - column A width equal to `columnWidthChars`,
  - the currency cell as a number with a numeric `numFmt`,
  - the date cell as a Date,
  - the boolean cell as a boolean,
  - the url cell with a `hyperlink`.
- A hidden column throws.

**Commit:** `feat(io): in-memory XLSX export to Blob with typed cells and frozen header`

---

## Task 14: Streaming XLSX writer, buildExport dispatcher, round trip

**Goal:** A streaming XLSX writer for large Node exports, the `buildExport` entry point that picks the right path at runtime, and the end-to-end round-trip acceptance test.

**Files:** under `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/`:
- `src/export/xlsx-stream.ts`, `src/export/build-export.ts`, `src/export/index.ts`, `src/index.ts` (barrels).
- Tests `test/export-xlsx-stream.test.ts`, `test/round-trip.test.ts`.

**API:**
- `buildXlsxStream(opts): Promise<Readable>`
  - Checks access, then creates a `PassThrough`.
  - Creates `new stream.xlsx.WorkbookWriter({ stream: passThrough, useStyles: true, useSharedStrings: false })`.
  - Sets column widths and freezes the header before any row is written. Adds the bold header row and commits it.
  - Returns the `PassThrough` immediately, and a background task writes rows from `toAsyncIterable`, committing each row. It finishes with `worksheet.commit()` and `workbook.commit()`.
  - If anything goes wrong, the error is passed to `passThrough.destroy(err)`.
- `isBrowserRuntime(): boolean`: `typeof window !== "undefined" && typeof document !== "undefined"`.
- `buildExportBlob(opts): Promise<Blob>`: CSV goes to `buildCsvBlob`, XLSX to `buildXlsxBlob`.
- `buildExportStream(opts): Promise<Readable>`: CSV goes to `buildCsvStream`, XLSX to `buildXlsxStream`.
- `buildExport(opts): Promise<Blob | Readable>`: uses the Blob path in a browser and the stream path in Node.
- `exportFileName(fileName, format)`: makes sure the name ends in `.csv` or `.xlsx`.
- `exportMimeType(format)`: the MIME type for the format.

**TDD cases:**
- **Streaming (node):**
  - 5000 async rows stream out, and when the result is loaded with exceljs it has 5001 rows, a frozen and bold header, and typed cells.
  - An iterator that throws midway makes the stream emit an error instead of hanging.
- **Dispatch:** `buildExport` in the node env returns a Readable (not a Blob). Blob-path dispatch is covered by T13's jsdom test plus a unit test with `isBrowserRuntime` mocked.
- **Round trip (acceptance):**
  - Export the fixture rows (every visible column type) to XLSX, then `parseFile` the collected bytes with the same `tz`.
  - Map the headers with `autoMapColumns` and check that every header maps to its own column at confidence 1.
  - For each cell, `type.format(unwrapParse(type.parse(parsedString, config)).value, config)` equals `type.format(originalValue, config)`. Covers number, currency, date, datetime (Kolkata), boolean, select, multiSelect, url, text.
  - The same property holds for CSV export followed by `parseFile`.
- **Hidden column:** `buildExport` with `c_secret` in `columns` rejects with `HiddenColumnError` (acceptance).

**Commit:** `feat(io): streaming XLSX export for Node, buildExport dispatcher and round-trip tests`

---

## Task 15: Packaging check and README

**Goal:** The built package exposes the four subpaths correctly, `./clipboard` has no heavy dependencies, and usage is documented.

**Files:** under `/Users/masai/Desktop/workspace/masai/schema-grid/packages/import-export/`: `README.md`, `test/exports.test.ts`; adjust `package.json` or `tsup.config.ts` if needed.

**TDD cases:**
- Each subpath barrel exports exactly the documented names, checked by listing its exports:
  - **import:** `parseFile`, `autoMapColumns`, `validateRows`, `toChangeBatches`, `keyOf`, `chunkRows`, `createImportJobState`, `recordChunkResult`, `buildErrorReportCsv`, `SheetNotFoundError`, `ImportConfigError`.
  - **export:** `buildExport`, `buildExportBlob`, `buildExportStream`, `exportFileName`, `exportMimeType`, `HiddenColumnError`.
  - **clipboard:** `formatForClipboard`, `formatMatrixForClipboard`, `parseClipboard`.
- A source scan of `src/clipboard` finds no imports of `exceljs`, `papaparse` or `node:` modules.
- No source file imports `@masai/schema-grid-core` directly except `src/internal/core.ts`.
- `bun run --filter @masai/schema-grid-io typecheck` and `test` are green, and `tsup` produces `dist/{index,import/index,export/index,clipboard/index}.{js,cjs,d.ts}`.
- The README explains:
  - which parts run in the browser and which in Node,
  - the order of calls in the import pipeline,
  - that `existingRowsByKey` must be built with `keyOf`,
  - the rule that `access` fails closed on export,
  - that timezone handling needs the same `tz` passed to `parseFile` and to export.
- Every remaining `TODO(core)` in `src/internal/core.ts` is listed in the README so the core team can close them.

**Commit:** `chore(io): verify subpath exports, clipboard isolation and document package usage`

---
