import type { ISODateTimeString, RoleRule } from "../common/types";
import type { FieldTypeId } from "../field-types/ids";
import type { FilterNode } from "../filter/types";
import type { GroupSpec, SortSpec } from "../query/types";

export type { RoleRule };

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
  /** Default true. false: header sort is off and servers reject sorting on it (`UNSORTABLE_COLUMN`). */
  sortable?: boolean;
  /** Default true. false: no column filter and hidden from filter pickers; `validateFilter` rejects it (`unfilterableColumn`). */
  filterable?: boolean;
  /**
   * Default true. false: the data source cannot write this column (e.g. a
   * computed "AI verified" flag). It stays visible, but its effective access
   * is at most "read" whatever the permissions say.
   */
  settable?: boolean;
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
  /**
   * Ids of collapsed group rows (grid-generated, stable for a given grouping
   * and group value). Omitted when every group is expanded.
   */
  collapsedGroups?: string[];
  pageSize: number;
}

export interface GridSchema {
  id: string;
  schemaVersion: number;
  columns: ColumnDef[];
  views?: ViewDef[];
}
