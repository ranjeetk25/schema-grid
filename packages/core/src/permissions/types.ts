import type { ColumnDef } from "../schema/types";
import type { GridRow } from "../rows/types";

export type Access = "hidden" | "read" | "edit";

export interface PermissionUser {
  id: string;
  roles: string[];
}

export interface PermissionContext {
  user: PermissionUser;
  column: ColumnDef;
  row?: GridRow;
}

export type PermissionResolver = (ctx: PermissionContext) => Access;
