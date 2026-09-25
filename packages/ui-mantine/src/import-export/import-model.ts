import { type AccessMap, readableColumns, writableColumns } from "../internal/access";
import type { ColumnDef, GridSchema } from "../internal/core-contracts";
import type {
  ColumnMapping,
  ImportMode,
  ParsedFile,
  RowValidationResult,
  UnknownEnumPolicy,
} from "../internal/io-contracts";

/** Only this many parsed rows are validated in the preview step. */
export const PREVIEW_ROW_LIMIT = 100;

export type ImportStep = 0 | 1 | 2 | 3;

export interface ImportPlan {
  fileName: string;
  file: File | null;
  parsed: ParsedFile;
  mapping: ColumnMapping;
  mode: ImportMode;
  keyColumnId: string | null;
  unknownEnumPolicy: UnknownEnumPolicy;
}

export interface ImportState {
  file: File | null;
  fileName: string;
  parsed: ParsedFile | null;
  parseError: string | null;
  mapping: ColumnMapping;
  keyColumnId: string | null;
  mode: ImportMode;
  unknownEnumPolicy: UnknownEnumPolicy;
  preview: RowValidationResult[] | null;
  previewError: string | null;
  /** 0 upload, 1 map, 2 preview, 3 run. */
  step: ImportStep;
}

export type ImportAction =
  | { type: "fileSelected"; file: File | null; fileName: string }
  | { type: "parsed"; parsed: ParsedFile; mapping: ColumnMapping }
  | { type: "parseFailed"; error: string }
  | { type: "setMapping"; header: string; columnId: string | null }
  | { type: "setKeyColumn"; columnId: string | null }
  | { type: "setMode"; mode: ImportMode }
  | { type: "setPolicy"; policy: UnknownEnumPolicy }
  | { type: "previewLoaded"; preview: RowValidationResult[] }
  | { type: "previewFailed"; error: string }
  | { type: "goTo"; step: ImportStep }
  | { type: "reset" };

/** A prototype-free mapping record, so headers like "constructor" or "__proto__" are plain keys. */
export function createMapping(entries?: ColumnMapping): ColumnMapping {
  const out: ColumnMapping = Object.create(null);
  if (entries) {
    for (const key of Object.keys(entries)) out[key] = entries[key] ?? null;
  }
  return out;
}

function hasOwn(record: ColumnMapping, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function mappedTarget(mapping: ColumnMapping, header: string): string | null {
  return hasOwn(mapping, header) ? (mapping[header] ?? null) : null;
}

export function initialImportState(): ImportState {
  return {
    file: null,
    fileName: "",
    parsed: null,
    parseError: null,
    mapping: createMapping(),
    keyColumnId: null,
    mode: "create",
    unknownEnumPolicy: "createOptions",
    preview: null,
    previewError: null,
    step: 0,
  };
}

export function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case "fileSelected":
      return {
        ...initialImportState(),
        mode: state.mode,
        file: action.file,
        fileName: action.fileName,
      };
    case "parsed":
      return {
        ...state,
        parsed: action.parsed,
        parseError: null,
        mapping: createMapping(action.mapping),
        preview: null,
        previewError: null,
      };
    case "parseFailed":
      return { ...state, parsed: null, parseError: action.error, mapping: createMapping(), preview: null };
    case "setMapping": {
      const mapping = createMapping(state.mapping);
      mapping[action.header] = action.columnId;
      return { ...state, mapping, preview: null, previewError: null };
    }
    case "setKeyColumn":
      return { ...state, keyColumnId: action.columnId, preview: null, previewError: null };
    case "setMode":
      return { ...state, mode: action.mode, preview: null, previewError: null };
    case "setPolicy":
      return { ...state, unknownEnumPolicy: action.policy };
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

/** Key column candidates: readable (never hidden), non-formula columns. */
export function keyColumnOptions(schema: GridSchema, access: AccessMap): ColumnDef[] {
  return readableColumns(schema, access).filter((c) => c.type !== "formula");
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

/** Every header gets an entry; targets not in `targets` become null (Skip). */
export function sanitizeMapping(headers: string[], mapping: ColumnMapping, targets: ColumnDef[]): ColumnMapping {
  const allowed = new Set(targets.map((c) => c.id));
  const out = createMapping();
  for (const h of headers) {
    const target = mappedTarget(mapping, h);
    out[h] = target != null && allowed.has(target) ? target : null;
  }
  return out;
}

export interface MappingErrors {
  /** Source header → message (duplicate or invalid target). */
  byHeader: Record<string, string>;
  /** Header index → message (duplicate or blank header in the file). */
  byIndex: Record<number, string>;
  keyColumn: string | null;
  general: string | null;
}

export function mappingErrors(state: ImportState, schema: GridSchema, access: AccessMap): MappingErrors {
  const byHeader: Record<string, string> = Object.create(null);
  const byIndex: Record<number, string> = {};
  const targets = mappingTargets(state, schema, access);
  const labelById = new Map(targets.map((c) => [c.id, c.label]));
  const headers = state.parsed?.headers ?? Object.keys(state.mapping);

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

  const headersByTarget = new Map<string, string[]>();
  for (const h of new Set(headers)) {
    const target = mappedTarget(state.mapping, h);
    if (target == null) continue;
    if (!labelById.has(target)) {
      byHeader[h] = "This column cannot be imported into";
      continue;
    }
    const list = headersByTarget.get(target) ?? [];
    list.push(h);
    headersByTarget.set(target, list);
  }
  for (const [target, list] of headersByTarget) {
    if (list.length < 2) continue;
    for (const h of list) {
      byHeader[h] = `Duplicate target: ${labelById.get(target) ?? target} is mapped more than once`;
    }
  }

  let keyColumn: string | null = null;
  if (state.mode !== "create") {
    if (!state.keyColumnId) {
      keyColumn = "A key column is required for update and upsert";
    } else if (!keyColumnOptions(schema, access).some((c) => c.id === state.keyColumnId)) {
      keyColumn = "This column cannot be used as a key";
    } else if (!headersByTarget.has(state.keyColumnId)) {
      keyColumn = "Map a file column to the key column";
    }
  }

  const general = headersByTarget.size === 0 ? "Map at least one column to import" : null;
  return { byHeader, byIndex, keyColumn, general };
}

export function hasMappingErrors(errors: MappingErrors): boolean {
  return (
    Object.keys(errors.byHeader).length > 0 ||
    Object.keys(errors.byIndex).length > 0 ||
    errors.keyColumn != null ||
    errors.general != null
  );
}

/** Whether "Next" is allowed on the current step. */
export function canProceed(state: ImportState, schema: GridSchema, access: AccessMap): boolean {
  if (!state.parsed) return false;
  if (state.step === 0) return state.parseError == null;
  if (state.step === 1) return !hasMappingErrors(mappingErrors(state, schema, access));
  if (state.step === 2) return state.preview != null && !hasMappingErrors(mappingErrors(state, schema, access));
  return false;
}

export function buildImportPlan(state: ImportState): ImportPlan | null {
  if (!state.parsed) return null;
  return {
    fileName: state.fileName,
    file: state.file,
    parsed: state.parsed,
    mapping: createMapping(state.mapping),
    mode: state.mode,
    keyColumnId: state.mode === "create" ? null : state.keyColumnId,
    unknownEnumPolicy: state.unknownEnumPolicy,
  };
}

export interface PreviewSummary {
  valid: number;
  invalid: number;
  unknownEnum: number;
}

export function summarizePreview(preview: RowValidationResult[]): PreviewSummary {
  let valid = 0;
  let invalid = 0;
  let unknownEnum = 0;
  for (const r of preview) {
    if (r.errors.length === 0 && !r.rowError) valid += 1;
    else invalid += 1;
    for (const e of r.errors) if (e.kind === "unknownEnum") unknownEnum += 1;
  }
  return { valid, invalid, unknownEnum };
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
