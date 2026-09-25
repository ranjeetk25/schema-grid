import type { ColumnDef, FieldTypeRegistry, FormulaResultType } from "../internal/core";

export type StorageKind = "text" | "number" | "boolean" | "date" | "datetime" | "choice" | "multi" | "ref" | "json";

export interface StorageInfo {
  kind: StorageKind;
  /**
   * JSON sub-path appended to `$.<key>` for comparisons:
   * - `"id"` for single refs stored as objects (`user` → `$.owner.id`)
   * - `"[*].id"` for arrays of refs (`link` → `$.links[*].id`, compared like a multi)
   */
  subPath?: string;
}

/** Per-type overrides so custom field types can declare how they are stored. */
export type StorageOverrides = Readonly<Record<string, StorageInfo>>;

const BY_TYPE: Readonly<Record<string, StorageInfo>> = {
  text: { kind: "text" },
  longText: { kind: "text" },
  url: { kind: "text" },
  email: { kind: "text" },
  phone: { kind: "text" },
  number: { kind: "number" },
  currency: { kind: "number" },
  boolean: { kind: "boolean" },
  date: { kind: "date" },
  datetime: { kind: "datetime" },
  select: { kind: "choice" },
  creatableSelect: { kind: "choice" },
  user: { kind: "ref", subPath: "id" },
  // Link values are LinkRef[] (core decision 9) → compared as an id array.
  link: { kind: "multi", subPath: "[*].id" },
  multiSelect: { kind: "multi" },
};

export function formulaResultKind(resultType: FormulaResultType | undefined): StorageKind {
  switch (resultType) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "datetime";
    default:
      return "text";
  }
}

export function storageKindOf(
  column: ColumnDef,
  _registry?: FieldTypeRegistry,
  overrides?: StorageOverrides,
): StorageInfo {
  const override = overrides?.[column.type];
  if (override) return override;
  if (column.type === "formula") {
    const rt = (column.config as { resultType?: FormulaResultType } | null)?.resultType;
    return { kind: formulaResultKind(rt) };
  }
  return BY_TYPE[column.type] ?? { kind: "json" };
}
