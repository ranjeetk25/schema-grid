import type { ColumnDef, FieldTypeRegistry, GridSchema } from "../internal/core-contracts";
import type { GridDraftColumn } from "../internal/grid-contracts";
import { getSelectOptions } from "../internal/options";
import { type ColumnDraft, type ColumnDraftErrors, buildColumnDef } from "./model";

/** Fields a requirement belongs to — used to reveal the matching inline error. */
export type RequirementField = "label" | "key" | "type" | "config" | "formula" | "permissions";

export interface Requirement {
  field: RequirementField;
  message: string;
}

/**
 * ag-grid's `SchemaGrid.draftColumn`: "create" renders a read-only ghost column
 * at `insertAt` (index among displayed columns, or next to a column id);
 * "edit" re-renders the real column with the draft's label/config.
 */
export type DraftColumn = GridDraftColumn;

const OPTION_REQUIRED = new Set(["select", "multiSelect"]);

function friendlyConfigError(message: string): string {
  if (/unique/i.test(message)) return "Option ids must be unique";
  return `Check the type settings (${message})`;
}

/**
 * Everything that blocks saving, in form order, phrased for people ("Name is
 * required · Add at least one option"). Builds on `validateColumnDraft`.
 */
export function draftRequirements(
  draft: ColumnDraft,
  {
    errors,
    formulaValid,
    permissionsError,
  }: { errors: ColumnDraftErrors; formulaValid: boolean; permissionsError: string | null },
): Requirement[] {
  const out: Requirement[] = [];
  if (errors.label) out.push({ field: "label", message: "Name is required" });
  if (errors.key && !errors.label) out.push({ field: "key", message: draft.key ? `Key: ${errors.key}` : "Key is required" });
  if (errors.type) out.push({ field: "type", message: "Choose a type" });
  if (draft.type && OPTION_REQUIRED.has(draft.type)) {
    const options = getSelectOptions(draft.config);
    if (options.length === 0) out.push({ field: "config", message: "Add at least one option" });
    else if (options.some((o) => !o.label.trim())) out.push({ field: "config", message: "Every option needs a label" });
  }
  if (errors.config && !out.some((r) => r.field === "config")) out.push({ field: "config", message: friendlyConfigError(errors.config) });
  if (draft.type === "formula") {
    if (!draft.formula.trim()) out.push({ field: "formula", message: "Enter a formula" });
    else if (!formulaValid) out.push({ field: "formula", message: "Fix the formula" });
  }
  if (permissionsError) out.push({ field: "permissions", message: "Pick at least one role for access" });
  return out;
}

const DRAFT_ID = "__draft__";

/**
 * The draft as a renderable ColumnDef for a live grid preview, or null while
 * it cannot render (no type yet, or a config the type rejects). Label and key
 * fall back to placeholders so the preview appears as soon as a type is picked.
 */
export function draftPreviewColumn(
  draft: ColumnDraft,
  { schema, registry, insertAt }: { schema: GridSchema; registry: FieldTypeRegistry; insertAt?: DraftColumn["insertAt"] },
): DraftColumn | null {
  if (!draft.type || !registry.get(draft.type)) return null;
  const keyOk = /^[a-z][a-z0-9_]*$/.test(draft.key) && !draft.existingKeys.includes(draft.key);
  const renderable: ColumnDraft = {
    ...draft,
    label: draft.label.trim() || "Untitled",
    key: draft.mode === "edit" ? draft.key : keyOk ? draft.key : DRAFT_ID,
  };
  try {
    const def = buildColumnDef(renderable, { schema, registry, now: draft.original?.updatedAt ?? "", generateId: () => DRAFT_ID });
    const mode = draft.mode === "edit" ? "edit" : "create";
    return insertAt === undefined ? { column: def, mode } : { column: def, insertAt, mode };
  } catch {
    return null;
  }
}

type Comparable = Pick<ColumnDraft, "type" | "label" | "key" | "config" | "required" | "defaultValue" | "indexed" | "permissions" | "formula">;

const snapshot = (d: ColumnDraft): string => {
  const c: Comparable = {
    type: d.type,
    label: d.label,
    key: d.key,
    config: d.config,
    required: d.required,
    defaultValue: d.defaultValue ?? null,
    indexed: d.indexed,
    permissions: d.permissions,
    formula: d.formula,
  };
  return JSON.stringify(c);
};

/** Whether the user changed anything since the form opened. */
export function isDraftDirty(initial: ColumnDraft, current: ColumnDraft): boolean {
  return initial !== current && snapshot(initial) !== snapshot(current);
}
