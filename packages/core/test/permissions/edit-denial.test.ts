import { describe, expect, it } from "vitest";
import {
  COLUMN_READ_ONLY_MESSAGE,
  cellEditDenial,
  FORMULA_READ_ONLY_MESSAGE,
  PERMISSION_EDIT_DENIED_MESSAGE,
} from "../../src/permissions/edit-denial";
import { createRolePermissionResolver } from "../../src/permissions/role-resolver";
import type { ColumnDef } from "../../src/schema/types";
import { FIXTURE_COLUMN_IDS as C, FIXTURE_USERS, createFixtureSchema } from "../../src/testing/schema";

const schema = createFixtureSchema();
const col = (id: string): ColumnDef => {
  const column = schema.columns.find((c) => c.id === id);
  if (!column) throw new Error(`fixture column ${id}`);
  return column;
};
const resolver = createRolePermissionResolver();
const counsellor = { id: FIXTURE_USERS.counsellor.id, roles: [...FIXTURE_USERS.counsellor.roles] };

describe("cellEditDenial", () => {
  it("has the three fixed messages", () => {
    expect(FORMULA_READ_ONLY_MESSAGE).toBe("Column is read-only (formula)");
    expect(COLUMN_READ_ONLY_MESSAGE).toBe("Column is read-only");
    expect(PERMISSION_EDIT_DENIED_MESSAGE).toBe("Only specific people can edit this column");
  });

  it("is null for an editable column", () => {
    expect(cellEditDenial(col(C.name), "edit")).toBeNull();
  });

  it("formula beats settable:false beats permissions", () => {
    expect(cellEditDenial(col(C.balance), "read")).toEqual({ reason: "formula", message: FORMULA_READ_ONLY_MESSAGE });
    expect(cellEditDenial({ ...col(C.fee), settable: false }, "read")).toEqual({
      reason: "readOnly",
      message: COLUMN_READ_ONLY_MESSAGE,
    });
    expect(cellEditDenial({ ...col(C.name), settable: false }, "edit")?.reason).toBe("readOnly");
  });

  it("a `permissions.edit` refusal says only specific people can edit, never who", () => {
    const fee = { ...col(C.fee), permissions: { read: "all" as const, edit: { roles: ["admin"], users: ["u9"] } } };
    const denial = cellEditDenial(fee, resolver({ user: counsellor, column: fee }));
    expect(denial).toEqual({ reason: "permission", message: PERMISSION_EDIT_DENIED_MESSAGE });
    expect(denial?.message).not.toMatch(/admin|u9/);
  });

  it("a refusal on a column without permissions (custom resolver) is plain read-only", () => {
    expect(cellEditDenial(col(C.name), "read")).toEqual({ reason: "readOnly", message: COLUMN_READ_ONLY_MESSAGE });
  });
});
