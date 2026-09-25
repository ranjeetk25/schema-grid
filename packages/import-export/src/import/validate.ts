import { isImportable } from "../internal/access";
import {
  type AnyFieldType,
  type ColumnDef,
  type FieldTypeRegistry,
  type GridSchema,
  columnsOf,
  getColumnFieldType,
  getSelectOptions,
  unwrapParse,
} from "../internal/core";
import { ImportConfigError } from "../internal/errors";
import { addNewOption, matchOption, splitMulti } from "./options";
import type {
  CellValidation,
  ColumnMapping,
  ParsedTable,
  RowValidation,
  ValidateRowsOptions,
  ValidationReport,
} from "./types";

/** A mapped column resolved once during setup. */
interface MappedColumn {
  headerIndex: number;
  column: ColumnDef;
  type: AnyFieldType;
}

/** Per-run state shared by cell parsers. */
interface ParseContext {
  opts: ValidateRowsOptions;
  newOptions: Record<string, string[]>;
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "Invalid value";
}

/** Records `label` as a new option of `columnId`; returns the kept spelling. */
function recordNewOption(
  ctx: ParseContext,
  columnId: string,
  label: string,
): string {
  const list = ctx.newOptions[columnId] ?? [];
  ctx.newOptions[columnId] = list;
  return addNewOption(list, label);
}

/** select / creatableSelect: match against config options, then apply the policy. */
function parseSelectCell(
  mapped: MappedColumn,
  raw: string,
  ctx: ParseContext,
): CellValidation {
  const match = matchOption(raw, getSelectOptions(mapped.column));
  if (match) return { value: match.value, raw };
  if (ctx.opts.unknownOptions === "reject") {
    return { value: null, raw, error: `Unknown option "${raw}"` };
  }
  return { value: recordNewOption(ctx, mapped.column.id, raw), raw };
}

/** multiSelect: split, match each piece, then apply the policy to unknowns. */
function parseMultiSelectCell(
  mapped: MappedColumn,
  raw: string,
  ctx: ParseContext,
): CellValidation {
  const options = getSelectOptions(mapped.column);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const piece of splitMulti(raw)) {
    const match = matchOption(piece, options);
    if (!match) unknown.push(piece);
    else if (!ids.includes(match.value)) ids.push(match.value);
  }
  if (unknown.length === 0) return { value: ids, raw };
  if (ctx.opts.unknownOptions === "reject") {
    const names = unknown.map((u) => `"${u}"`).join(", ");
    return { value: null, raw, error: `Unknown option(s) ${names}` };
  }
  const labels = unknown.map((u) => recordNewOption(ctx, mapped.column.id, u));
  return { value: [...ids, ...labels], raw };
}

/** Any other type: the field type's own parse, honouring `pendingOptions`. */
function parseWithFieldType(
  mapped: MappedColumn,
  raw: string,
  ctx: ParseContext,
): CellValidation {
  const r = unwrapParse(mapped.type.parse(raw, mapped.column.config));
  if (!r.ok) return { value: null, raw, error: r.error };
  if (r.pendingOptions && r.pendingOptions.length > 0) {
    if (ctx.opts.unknownOptions === "reject") {
      const names = r.pendingOptions.map((u) => `"${u}"`).join(", ");
      return { value: null, raw, error: `Unknown option(s) ${names}` };
    }
    for (const p of r.pendingOptions) recordNewOption(ctx, mapped.column.id, p);
  }
  return { value: r.value, raw };
}

/**
 * Parses one non-empty, trimmed cell. Never throws: a throwing parse becomes a
 * cell error. Option types use the import's unknown-option policy instead of
 * the field type's own parse.
 */
function parseCell(
  mapped: MappedColumn,
  raw: string,
  ctx: ParseContext,
): CellValidation {
  try {
    switch (mapped.column.type) {
      case "select":
      case "creatableSelect":
        return parseSelectCell(mapped, raw, ctx);
      case "multiSelect":
        return parseMultiSelectCell(mapped, raw, ctx);
      default:
        return parseWithFieldType(mapped, raw, ctx);
    }
  } catch (err) {
    return { value: null, raw, error: messageOf(err) };
  }
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Normalised identity of a key cell, used for duplicate detection.
 * TODO(T9): replace with the exported `keyOf` (same rule) once it exists.
 */
function normalizedKey(cell: CellValidation, mapped: MappedColumn): string {
  if (cell.error === undefined && !isEmptyValue(cell.value)) {
    try {
      const formatted = mapped.type.format(cell.value, mapped.column.config);
      if (typeof formatted === "string" && formatted.trim() !== "") {
        return formatted.trim().toLowerCase();
      }
    } catch {
      // fall through to the raw string
    }
  }
  return cell.raw.trim().toLowerCase();
}

function resolveMappings(
  mapping: ColumnMapping[],
  columns: ColumnDef[],
  registry: FieldTypeRegistry,
  opts: ValidateRowsOptions,
): MappedColumn[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const seen = new Map<string, string>();
  const out: MappedColumn[] = [];

  for (const m of mapping) {
    if (m.columnId === null) continue;
    const column = byId.get(m.columnId);
    if (!column) {
      throw new ImportConfigError(
        `Header "${m.header}" is mapped to unknown column "${m.columnId}"`,
      );
    }
    if (column.type === "formula") {
      throw new ImportConfigError(
        `Column "${column.label}" is a formula and cannot be imported`,
      );
    }
    const prev = seen.get(column.id);
    if (prev !== undefined) {
      throw new ImportConfigError(
        `Headers "${prev}" and "${m.header}" are both mapped to column "${column.label}"`,
      );
    }
    seen.set(column.id, m.header);
    const type = getColumnFieldType(column, registry);
    if (!type) {
      throw new ImportConfigError(
        `Column "${column.label}" has unknown field type "${column.type}"`,
      );
    }
    if (opts.access && column.id !== opts.keyColumnId) {
      if (!isImportable(column, opts.access)) {
        throw new ImportConfigError(
          `You do not have permission to edit column "${column.label}"`,
        );
      }
    }
    out.push({ headerIndex: m.headerIndex, column, type });
  }

  if (opts.mode !== "create") {
    if (!opts.keyColumnId) {
      throw new ImportConfigError(`Mode "${opts.mode}" requires a key column`);
    }
    if (!seen.has(opts.keyColumnId)) {
      throw new ImportConfigError(
        `Key column "${opts.keyColumnId}" must be mapped in "${opts.mode}" mode`,
      );
    }
    if (opts.access) {
      const a = opts.access.get(opts.keyColumnId);
      if (a === undefined || a === "hidden") {
        throw new ImportConfigError(
          `Key column "${opts.keyColumnId}" is not visible to you`,
        );
      }
    }
  }
  return out;
}

/**
 * Validates every row of a parsed file against the mapped schema columns.
 * Throws ImportConfigError for an unusable mapping before any row is read.
 */
export function validateRows(
  parsed: ParsedTable,
  mapping: ColumnMapping[],
  schema: GridSchema | ColumnDef[],
  registry: FieldTypeRegistry,
  opts: ValidateRowsOptions,
): ValidationReport {
  const columns = columnsOf(schema);
  const mapped = resolveMappings(mapping, columns, registry, opts);
  const keyMapped =
    opts.mode === "create"
      ? undefined
      : mapped.find((m) => m.column.id === opts.keyColumnId);

  const ctx: ParseContext = { opts, newOptions: {} };
  const headerRow = parsed.headerRow ?? 1;
  const firstSeenKey = new Map<string, number>();
  const rows: RowValidation[] = [];
  let valid = 0;
  let invalid = 0;

  const sourceRows =
    opts.limit !== undefined && opts.limit >= 0
      ? parsed.rows.slice(0, opts.limit)
      : parsed.rows;
  sourceRows.forEach((sourceCells, index) => {
    const sourceRow = headerRow + index + 1;
    const rawOf = (m: MappedColumn) => (sourceCells[m.headerIndex] ?? "").trim();

    // In upsert, a row with a key is an update; without one it is a create.
    const keyRaw = keyMapped ? rawOf(keyMapped) : "";
    const isUpdateRow =
      opts.mode === "update" || (opts.mode === "upsert" && keyRaw !== "");

    const cells: Record<string, CellValidation> = {};
    let hasCellError = false;
    for (const m of mapped) {
      const raw = rawOf(m);
      let cell: CellValidation;
      if (raw === "") {
        cell = isUpdateRow
          ? { value: null, raw, skip: true }
          : { value: null, raw };
      } else {
        cell = parseCell(m, raw, ctx);
      }
      if (
        !isUpdateRow &&
        m.column.required &&
        cell.error === undefined &&
        isEmptyValue(cell.value)
      ) {
        cell.error = "Required";
      }
      if (cell.error !== undefined) hasCellError = true;
      cells[m.column.id] = cell;
    }

    let rowError: string | undefined;
    if (keyMapped) {
      if (keyRaw === "") {
        if (opts.mode === "update") rowError = "Missing key";
      } else {
        const keyCell = cells[keyMapped.column.id];
        const k = keyCell ? normalizedKey(keyCell, keyMapped) : keyRaw.toLowerCase();
        const first = firstSeenKey.get(k);
        if (first !== undefined) {
          rowError = `Duplicate key (first seen on row ${first})`;
        } else {
          firstSeenKey.set(k, sourceRow);
        }
      }
    }

    const row: RowValidation = { index, sourceRow, cells };
    if (rowError !== undefined) row.rowError = rowError;
    rows.push(row);
    if (rowError !== undefined || hasCellError) invalid += 1;
    else valid += 1;
  });

  const mappedIds = new Set(mapped.map((m) => m.column.id));
  const unmappedRequired =
    opts.mode === "update"
      ? []
      : columns
          .filter(
            (c) =>
              c.required &&
              !mappedIds.has(c.id) &&
              c.type !== "formula" &&
              (!opts.access || isImportable(c, opts.access)),
          )
          .map((c) => c.id);

  return {
    rows,
    summary: { valid, invalid, newOptions: ctx.newOptions, unmappedRequired },
  };
}
