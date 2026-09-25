import { describe, expect, it } from "vitest";
import type { ColDef, EditableCallbackParams } from "ag-grid-community";
import {
  createDefaultRegistry,
  createRolePermissionResolver,
  resolveColumnAccess,
  type Access,
  type GridRow,
  type GridUser,
  type PermissionResolver,
} from "../../src/internal/core";
import { compileColumns } from "../../src/compile/compileColumns";
import { createCellAccess } from "../../src/compile/cellAccess";
import { createDefaultUiRegistry } from "../../src/compile/uiRegistry";
import { ADMIN, AGENT, fixtureRows, fixtureSchema } from "../fixtures/schema";

const registry = createDefaultRegistry();
const ui = createDefaultUiRegistry();
const roleResolver = createRolePermissionResolver<GridRow>();

function compile(user: GridUser, resolver: PermissionResolver<GridRow> = roleResolver): ColDef<GridRow>[] {
  const access = resolveColumnAccess(fixtureSchema, resolver, user);
  const canEditCell = createCellAccess(fixtureSchema, access, resolver, user);
  return compileColumns(fixtureSchema, access, registry, ui, { canEditCell });
}

function effective(defs: ColDef<GridRow>[], columnId: string, data: GridRow): Access {
  const def = defs.find((d) => d.colId === columnId);
  if (!def) return "hidden";
  const editable =
    typeof def.editable === "function" ? def.editable({ data } as EditableCallbackParams<GridRow>) : def.editable === true;
  return editable ? "edit" : "read";
}

const r1 = fixtureRows[0] as GridRow;

describe("permissions matrix (roles x access)", () => {
  const matrix: [string, GridUser, string, Access][] = [
    ["ADMIN", ADMIN, "name", "edit"],
    ["AGENT", AGENT, "name", "edit"],
    ["ADMIN", ADMIN, "salary", "edit"],
    ["AGENT", AGENT, "salary", "hidden"],
    ["ADMIN", ADMIN, "status", "edit"],
    ["AGENT", AGENT, "status", "read"],
    ["ADMIN", ADMIN, "total", "read"],
    ["AGENT", AGENT, "total", "read"],
  ];
  it.each(matrix)("%s / %s -> %s", (_label, user, columnId, expected) => {
    expect(effective(compile(user), columnId, r1)).toBe(expected);
  });

  it("formula column is never editable even if the resolver claims edit", () => {
    const allEdit: PermissionResolver<GridRow> = () => "edit";
    expect(effective(compile(ADMIN, allEdit), "total", r1)).toBe("read");
    const access = resolveColumnAccess(fixtureSchema, allEdit, ADMIN);
    expect(createCellAccess(fixtureSchema, access, allEdit, ADMIN)(r1, "total")).toBe(false);
  });

  it("a row-level resolver override returns read for a specific row", () => {
    const rowLocked: PermissionResolver<GridRow> = (ctx) =>
      ctx.row?.id === "r2" && ctx.column.id === "status" ? "read" : roleResolver(ctx);
    const defs = compile(ADMIN, rowLocked);
    expect(effective(defs, "status", r1)).toBe("edit");
    expect(effective(defs, "status", fixtureRows[1] as GridRow)).toBe("read");
    expect(effective(defs, "name", fixtureRows[1] as GridRow)).toBe("edit");
  });

  it("createCellAccess is false for unknown or non-edit columns", () => {
    const access = resolveColumnAccess(fixtureSchema, roleResolver, AGENT);
    const can = createCellAccess(fixtureSchema, access, roleResolver, AGENT);
    expect(can(r1, "nope")).toBe(false);
    expect(can(r1, "status")).toBe(false);
    expect(can(r1, "salary")).toBe(false);
    expect(can(r1, "name")).toBe(true);
  });
});
