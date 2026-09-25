import { type AccessMap, readableColumns, writableColumns } from "../internal/access";
import type { ColumnDef, GridSchema } from "../internal/core-contracts";
import {
  type ColumnMapping,
  type ImportMode,
  KEY_COLUMN_TYPES,
  type ParsedTable,
  type UnknownOptionsPolicy,
  type ValidationReport,
} from "../internal/io-contracts";

/** Only this many parsed rows are validated in the preview step. */
export const PREVIEW_ROW_LIMIT = 100;

export type ImportStep = 0 | 1 | 2 | 3;

/** What the wizard commits. Named to avoid io's server-side `ImportPlan`. */
export interface ImportWizardPlan {
  fileName: string;
  file: File | null;
  parsed: ParsedTable;
  /** One entry per file header, keyed by `headerIndex`. */
  mapping: ColumnMapping[];
  mode: ImportMode;
  /** Always null in create mode. */
  keyColumnId: string | null;
  unknownOptions: UnknownOptionsPolicy;
}

export interface ImportState {
  file: File | null;
  fileName: string;
  parsed: ParsedTable | null;
  parseError: string | null;
  mapping: ColumnMapping[];
  keyColumnId: string | null;
  mode: ImportMode;
  unknownOptions: UnknownOptionsPolicy;
  preview: ValidationReport | null;
  previewError: string | null;
  /** 0 upload, 1 map, 2 preview, 3 run. */
  step: ImportStep;
}

export type ImportAction =
  | { type: "fileSelected"; file: File | null; fileName: string }
  | { type: "parsed"; parsed: ParsedTable; mapping: ColumnMapping[] }
  | { type: "parseFailed"; error: string }
  | { type: "setMapping"; headerIndex: number; columnId: string | null }
  | { type: "setKeyColumn"; columnId: string | null }
  | { type: "setMode"; mode: ImportMode }
  | { type: "setPolicy"; policy: UnknownOptionsPolicy }
  | { type: "previewLoaded"; preview: ValidationReport }
  | { type: "previewFailed"; error: string }
  | { type: "goTo"; step: ImportStep }
  | { type: "reset" };

export function initialImportState(): ImportState {
  return {
    file: null,
    fileName: "",
    parsed: null,
    parseError: null,
    mapping: [],
    keyColumnId: null,
    mode: "create",
    unknownOptions: "create",
    preview: null,
    previewError: null,
    step: 0,
  };
}

export function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case "fileSelected":
      return { ...initialImportState(), mode: state.mode, file: action.file, fileName: action.fileName };
    case "parsed":
      return { ...state, parsed: action.parsed, parseError: null, mapping: action.mapping, preview: null, previewError: null };
    case "parseFailed":
      return { ...state, parsed: null, parseError: action.error, mapping: [], preview: null };
    case "setMapping":
      return {
        ...state,
        mapping: state.mapping.map((m) =>
          m.headerIndex === action.headerIndex
            ? { ...m, columnId: action.columnId, confidence: action.columnId == null ? 0 : 1 }
            : m,
        ),
        preview: null,
        previewError: null,
      };
    case "setKeyColumn":
      return { ...state, keyColumnId: action.columnId, preview: null, previewError: null };
    case "setMode":
      return { ...state, mode: action.mode, preview: null, previewError: null };
    case "setPolicy":
      return { ...state, unknownOptions: action.policy };
    case "previewLoaded":
      return { ...state, preview: action.preview, previewError: null };
    case "previewFailed":
      return { ...state, preview: null, previewError: action.error };
    case "goTo":
      return { ...state, step: action.step };
    case "reset":
      return initialImportState();
  }
}

/** Import targets: writable, non-hidden, non-formula columns. */
export function targetColumns(schema: GridSchema, access: AccessMap): ColumnDef[] {
  return writableColumns(schema, access);
}

/** Key column candidates: readable (never hidden) columns of a type io accepts as a key. */
export function keyColumnOptions(schema: GridSchema, access: AccessMap): ColumnDef[] {
  return readableColumns(schema, access).filter((c) => KEY_COLUMN_TYPES.has(c.type));
}

/**
 * The key column when it is usable but not writable: it can be mapped only to
 * match existing rows (update/upsert), never written.
 */
export function matchOnlyKeyColumn(
  state: Pick<ImportState, "mode" | "keyColumnId">,
  schema: GridSchema,
  access: AccessMap,
): ColumnDef | null {
  if (state.mode === "create" || !state.keyColumnId) return null;
  if (targetColumns(schema, access).some((c) => c.id === state.keyColumnId)) return null;
  return keyColumnOptions(schema, access).find((c) => c.id === state.keyColumnId) ?? null;
}

/** Columns a header may map to right now: import targets plus a match-only key column. */
export function mappingTargets(
  state: Pick<ImportState, "mode" | "keyColumnId">,
  schema: GridSchema,
  access: AccessMap,
): ColumnDef[] {
  const targets = targetColumns(schema, access);
  const key = matchOnlyKeyColumn(state, schema, access);
  return key ? [...targets, key] : targets;
}

/**
 * One entry per header (by index). Suggestions whose target is not in
 * `targets`, or that point at a missing header, become Skip.
 */
export function sanitizeMapping(headers: string[], mapping: ColumnMapping[], targets: ColumnDef[]): ColumnMapping[] {
  const allowed = new Set(targets.map((c) => c.id));
  return headers.map((header, headerIndex) => {
    const suggested = mapping.find((m) => m.headerIndex === headerIndex);
    const columnId = suggested?.columnId != null && allowed.has(suggested.columnId) ? suggested.columnId : null;
    return { header, headerIndex, columnId, confidence: columnId == null ? 0 : (suggested?.confidence ?? 1) };
  });
}

export interface MappingErrors {
  /** Header index → message (duplicate/blank header, duplicate or invalid target). */
  byIndex: Record<number, string>;
  keyColumn: string | null;
  general: string | null;
}

export function mappingErrors(state: ImportState, schema: GridSchema, access: AccessMap): MappingErrors {
  const byIndex: Record<number, string> = {};
  const targets = mappingTargets(state, schema, access);
  const labelById = new Map(targets.map((c) => [c.id, c.label]));
  const headers = state.parsed?.headers ?? state.mapping.map((m) => m.header);

  const indexesByHeader = new Map<string, number[]>();
  headers.forEach((h, i) => {
    if (h.trim() === "") {
      byIndex[i] = "Blank header: give this column a name in the file";
      return;
    }
    const list = indexesByHeader.get(h) ?? [];
    list.push(i);
    indexesByHeader.set(h, list);
  });
  for (const [h, list] of indexesByHeader) {
    if (list.length < 2) continue;
    for (const i of list) byIndex[i] = `Duplicate header "${h}": rename it in the file`;
  }

  const indexesByTarget = new Map<string, number[]>();
  for (const m of state.mapping) {
    if (m.columnId == null) continue;
    if (!labelById.has(m.columnId)) {
      byIndex[m.headerIndex] ??= "This column cannot be imported into";
      continue;
    }
    const list = indexesByTarget.get(m.columnId) ?? [];
    list.push(m.headerIndex);
    indexesByTarget.set(m.columnId, list);
  }
  for (const [target, list] of indexesByTarget) {
    if (list.length < 2) continue;
    for (const i of list) {
      byIndex[i] ??= `Duplicate target: ${labelById.get(target) ?? target} is mapped more than once`;
    }
  }

  let keyColumn: string | null = null;
  if (state.mode !== "create") {
    if (!state.keyColumnId) {
      keyColumn = "A key column is required for update and upsert";
    } else if (!keyColumnOptions(schema, access).some((c) => c.id === state.keyColumnId)) {
      keyColumn = "This column cannot be used as a key";
    } else if (!indexesByTarget.has(state.keyColumnId)) {
      keyColumn = "Map a file column to the key column";
    }
  }

  const general = indexesByTarget.size === 0 ? "Map at least one column to import" : null;
  return { byIndex, keyColumn, general };
}

export function hasMappingErrors(errors: MappingErrors): boolean {
  return Object.keys(errors.byIndex).length > 0 || errors.keyColumn != null || errors.general != null;
}

/** Whether "Next" is allowed on the current step. */
export function canProceed(state: ImportState, schema: GridSchema, access: AccessMap): boolean {
  if (!state.parsed) return false;
  if (state.step === 0) return state.parseError == null;
  if (state.step === 1) return !hasMappingErrors(mappingErrors(state, schema, access));
  if (state.step === 2) return state.preview != null && !hasMappingErrors(mappingErrors(state, schema, access));
  return false;
}

export function buildImportPlan(state: ImportState): ImportWizardPlan | null {
  if (!state.parsed) return null;
  return {
    fileName: state.fileName,
    file: state.file,
    parsed: state.parsed,
    mapping: state.mapping.map((m) => ({ ...m })),
    mode: state.mode,
    keyColumnId: state.mode === "create" ? null : state.keyColumnId,
    unknownOptions: state.unknownOptions,
  };
}

export interface PreviewSummary {
  valid: number;
  invalid: number;
  /** Distinct unknown option labels across columns (io `summary.unknownOptions`, same under either policy). */
  unknownOptions: number;
}

export function summarizePreview(report: ValidationReport): PreviewSummary {
  let unknownOptions = 0;
  for (const labels of Object.values(report.summary.unknownOptions)) unknownOptions += labels.length;
  return { valid: report.summary.valid, invalid: report.summary.invalid, unknownOptions };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
