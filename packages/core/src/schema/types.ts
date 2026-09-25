import type { ISODateTimeString } from "../common/types";
import type { FieldTypeId } from "../field-types/ids";
import type { FilterNode } from "../filter/types";
import type { GroupSpec, SortSpec } from "../query/types";

export type RoleRule = "all" | { roles: string[] };

export interface ColumnPermissions {
  read: RoleRule;
  edit: RoleRule;
}

export interface ColumnValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  message?: string;
}

export interface ColumnDef {
  id: string;
  key: string;
  label: string;
  type: FieldTypeId;
  /** Validated by the field type's configSchema. */
  config: unknown;
  required?: boolean;
  defaultValue?: unknown;
  validation?: ColumnValidation;
  permissions?: ColumnPermissions;
  width?: number;
  pinned?: "left" | "right" | null;
  hidden?: boolean;
  order: number;
  indexed?: boolean;
  /** Only when type === "formula". */
  formula?: string;
  /** Maps to an existing DB column. */
  source?: { valueField: string };
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface ColumnState {
  id: string;
  hidden: boolean;
  width: number;
  pinned: "left" | "right" | null;
  order: number;
}

export interface ViewDef {
  id: string;
  name: string;
  filter: FilterNode | null;
  sort: SortSpec[];
  search?: string;
  columnState: ColumnState[];
  groupBy: GroupSpec[];
  pageSize: number;
}

export interface GridSchema {
  id: string;
  schemaVersion: number;
  columns: ColumnDef[];
  views?: ViewDef[];
}
