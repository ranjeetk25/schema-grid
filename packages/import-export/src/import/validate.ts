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
import { keyOf } from "./change-batches";
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
  unknownOptions: Record<string, string[]>;
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "Invalid value";
}

function addTo(target: Record<string, string[]>, columnId: string, label: string): string {
  const list = target[columnId] ?? [];
  target[columnId] = list;
  return addNewOption(list, label);
}

/**
 * Records unknown `labels` of `columnId` (always) and applies the policy:
 * "reject" returns the cell error; "create" records them as new options and
 * returns the kept spellings.
 */
function handleUnknown(
  ctx: ParseContext,
  columnId: string,
  labels: string[],
  raw: string,
  single: boolean,
): { error: CellValidation } | { kept: string[] } {
  for (const l of labels) addTo(ctx.unknownOptions, columnId, l);
  if (ctx.opts.unknownOptions === "reject") {
    const error = single
      ? `Unknown option "${raw}"`
      : `Unknown option(s) ${labels.map((u) => `"${u}"`).join(", ")}`;
    return { error: { value: null, raw, error, errorKind: "unknownOption" } };
  }
  return { kept: labels.map((l) => addTo(ctx.newOptions, columnId, l)) };
}

/** select / creatableSelect: match against config options, then apply the policy. */
function parseSelectCell(
  mapped: MappedColumn,
  raw: string,
  ctx: ParseContext,
): CellValidation {
  const match = matchOption(raw, getSelectOptions(mapped.column));
  if (match) return { value: match.value, raw };
  const r = handleUnknown(ctx, mapped.column.id, [raw], raw, true);
  return "error" in r ? r.error : { value: r.kept[0], raw };
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
  const order = (id: string) => options.findIndex((o) => o.value === id);
  ids.sort((a, b) => order(a) - order(b));
  if (unknown.length === 0) return { value: ids, raw };
  const r = handleUnknown(ctx, mapped.column.id, unknown, raw, false);
  return "error" in r ? r.error : { value: [...ids, ...r.kept], raw };
}

/** Any other type: the field type's own parse, honouring `pendingOptions`. */
function parseWithFieldType(
  mapped: MappedColumn,
  raw: string,
  ctx: ParseContext,
): CellValidation {
  const r = unwrapParse(mapped.type.parse(raw, mapped.column.config));
  if (!r.ok) return { value: null, raw, error: r.error, errorKind: "parse" };
  if (r.pendingOptions && r.pendingOptions.length > 0) {
    const handled = handleUnknown(ctx, mapped.column.id, r.pendingOptions, raw, false);
    if ("error" in handled) return handled.error;
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
    return { value: null, raw, error: messageOf(err), errorKind: "parse" };
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
 * Duplicate-detection identity of a key cell: the exported `keyOf` for a parsed
 * value (the same function the server uses for `existingRowsByKey`), or the
 * raw text trimmed + lowercased when the cell failed to parse.
 */
function normalizedKey(
  cell: CellValidation,
  mapped: MappedColumn,
  registry: FieldTypeRegistry,
): string {
  if (cell.error === undefined && !isEmptyValue(cell.value)) {
    const k = keyOf(cell.value, mapped.column, registry);
    if (k !== "") return k;
  }
  return cell.raw.trim().toLowerCase();
}

/**
 * Field types whose formatted value is a lossless, canonical identity and so
 * can serve as an update/upsert key (see `keyOf`).
 */
export const KEY_COLUMN_TYPES: ReadonlySet<string> = Object.freeze(
  new Set(["text", "longText", "email", "phone", "url"]),
);

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
    const keyColumn = columns.find((c) => c.id === opts.keyColumnId);
    if (keyColumn && !KEY_COLUMN_TYPES.has(keyColumn.type)) {
      throw new ImportConfigError(
        `Column "${keyColumn.label}" (type ${keyColumn.type}) cannot be used as a key; use a text, long text, email, phone or URL column`,
      );
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

  const ctx: ParseContext = { opts, newOptions: {}, unknownOptions: {} };
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
        cell.errorKind = "required";
      }
      if (cell.error !== undefined) hasCellError = true;
      cells[m.column.id] = cell;
    }

    let rowError: string | undefined;
    if (keyMapped) {
      if (keyRaw === "") {
        if (opts.mode === "update") rowError = "Missing key";
      } else {
        const keyCell = cells[keyMapped.column.id] ?? { value: null, raw: keyRaw };
        const k = normalizedKey(keyCell, keyMapped, registry);
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
    summary: {
      valid,
      invalid,
      newOptions: ctx.newOptions,
      unknownOptions: ctx.unknownOptions,
      unmappedRequired,
    },
  };
}
