import type {
  ColumnDef,
  ColumnPermissions,
  FieldTypeId,
  FieldTypeRegistry,
  GridSchema,
} from "../internal/core-contracts";
import { KEY_PATTERN, slugifyKey, uniqueKey } from "./keys";

export interface ColumnDraft {
  mode: "create" | "edit";
  /** The column being edited (edit mode). */
  original: ColumnDef | null;
  type: FieldTypeId | null;
  label: string;
  key: string;
  keyTouched: boolean;
  config: Record<string, unknown>;
  required: boolean;
  defaultValue: unknown;
  indexed: boolean;
  permissions: ColumnPermissions;
  formula: string;
  /** Keys of other columns (for uniqueness). */
  existingKeys: string[];
}

export type ColumnDraftAction =
  | { type: "setType"; fieldType: FieldTypeId; registry: FieldTypeRegistry }
  | { type: "setLabel"; label: string }
  | { type: "setKey"; key: string }
  | { type: "setConfig"; config: Record<string, unknown> }
  | { type: "setRequired"; required: boolean }
  | { type: "setDefault"; value: unknown }
  | { type: "setIndexed"; indexed: boolean }
  | { type: "setPermissions"; permissions: ColumnPermissions }
  | { type: "setFormula"; formula: string };

export const DEFAULT_PERMISSIONS: ColumnPermissions = { read: "all", edit: "all" };

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

export function createColumnDraft({
  schema,
  registry,
  column,
  initialType,
}: {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  column?: ColumnDef | null;
  initialType?: FieldTypeId;
}): ColumnDraft {
  const existingKeys = schema.columns.filter((c) => c.id !== column?.id).map((c) => c.key);
  if (column) {
    return {
      mode: "edit",
      original: column,
      type: column.type,
      label: column.label,
      key: column.key,
      keyTouched: true,
      config: asRecord(column.config),
      required: column.required ?? false,
      defaultValue: column.defaultValue,
      indexed: column.indexed ?? false,
      permissions: column.permissions ?? DEFAULT_PERMISSIONS,
      formula: column.formula ?? "",
      existingKeys,
    };
  }
  const type = initialType ?? null;
  return {
    mode: "create",
    original: null,
    type,
    label: "",
    key: "",
    keyTouched: false,
    config: type ? asRecord(registry.get(type)?.defaultConfig) : {},
    required: false,
    defaultValue: undefined,
    indexed: false,
    permissions: DEFAULT_PERMISSIONS,
    formula: "",
    existingKeys,
  };
}

export function columnDraftReducer(draft: ColumnDraft, action: ColumnDraftAction): ColumnDraft {
  switch (action.type) {
    case "setType":
      if (draft.mode === "edit" || draft.type === action.fieldType) return draft;
      return {
        ...draft,
        type: action.fieldType,
        config: asRecord(action.registry.get(action.fieldType)?.defaultConfig),
        defaultValue: undefined,
        formula: "",
      };
    case "setLabel": {
      const next = { ...draft, label: action.label };
      if (draft.mode === "create" && !draft.keyTouched) {
        next.key = action.label.trim() ? uniqueKey(slugifyKey(action.label), draft.existingKeys) : "";
      }
      return next;
    }
    case "setKey":
      if (draft.mode === "edit") return draft;
      return { ...draft, key: action.key, keyTouched: true };
    case "setConfig":
      return { ...draft, config: action.config };
    case "setRequired":
      return { ...draft, required: action.required };
    case "setDefault":
      return { ...draft, defaultValue: action.value };
    case "setIndexed":
      return { ...draft, indexed: action.indexed };
    case "setPermissions":
      return { ...draft, permissions: action.permissions };
    case "setFormula":
      return { ...draft, formula: action.formula };
  }
}

export interface ColumnDraftErrors {
  type?: string;
  label?: string;
  key?: string;
  config?: string;
}

/** Field-level errors for the common fields + config (formula validity is checked by FormulaEditor). */
export function validateColumnDraft(
  draft: ColumnDraft,
  { registry }: { schema: GridSchema; registry: FieldTypeRegistry },
): ColumnDraftErrors {
  const errors: ColumnDraftErrors = {};
  const fieldType = draft.type ? registry.get(draft.type) : undefined;
  if (!fieldType) errors.type = "Choose a field type";
  if (!draft.label.trim()) errors.label = "Label is required";
  if (!draft.key) errors.key = "Key is required";
  else if (!KEY_PATTERN.test(draft.key)) errors.key = "Use lowercase letters, digits and _, starting with a letter";
  else if (draft.existingKeys.includes(draft.key)) errors.key = "This key is already used by another column";
  if (fieldType && draft.type !== "formula") {
    const parsed = fieldType.configSchema.safeParse(draft.config);
    if (!parsed.success) errors.config = parsed.error.issues[0]?.message ?? "Invalid configuration";
  }
  return errors;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Builds the full ColumnDef. `config` goes through the type's `configSchema` (throws on invalid config). */
export function buildColumnDef(
  draft: ColumnDraft,
  { schema, registry, now, generateId }: { schema: GridSchema; registry: FieldTypeRegistry; now: string; generateId: () => string },
): ColumnDef {
  if (!draft.type) throw new Error("Column type is required");
  const fieldType = registry.get(draft.type);
  if (!fieldType) throw new Error(`Unknown field type "${draft.type}"`);
  const config = fieldType.configSchema.parse(draft.config) as unknown;
  const isFormula = draft.type === "formula";
  const original = draft.mode === "edit" ? draft.original : null;
  const maxOrder = schema.columns.reduce((m, c) => Math.max(m, c.order), -1);

  const column: ColumnDef = {
    ...(original ?? {}),
    id: original?.id ?? generateId(),
    key: original?.key ?? draft.key,
    label: draft.label.trim(),
    type: draft.type,
    config,
    required: isFormula ? false : draft.required,
    indexed: draft.indexed,
    permissions: draft.permissions,
    order: original?.order ?? maxOrder + 1,
    createdAt: original?.createdAt ?? now,
    updatedAt: now,
  };
  if (isFormula) column.formula = draft.formula;
  else delete column.formula;
  if (!isFormula && !isBlank(draft.defaultValue)) column.defaultValue = draft.defaultValue;
  else delete column.defaultValue;
  return column;
}
