import { describe, expect, it } from "vitest";
import type { ColumnDef, GridSchema, RoleRule } from "../../src/schema/types";
import type { PermissionContext, PermissionUser } from "../../src/permissions/types";
import { createRolePermissionResolver } from "../../src/permissions/role-resolver";
import {
  editableColumnIds,
  readableColumnIds,
  resolveColumnAccess,
} from "../../src/permissions/column-access";

function makeColumn(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id: "col-1",
    key: "status",
    label: "Status",
    type: "text",
    config: {},
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSchema(columns: ColumnDef[]): GridSchema {
  return { id: "schema-1", schemaVersion: 1, columns };
}

function user(roles: string[]): PermissionUser {
  return { id: "u1", roles };
}

describe("createRolePermissionResolver — matrix", () => {
  const resolver = createRolePermissionResolver();

  const readOptions: RoleRule[] = ["all", { roles: ["admin"] }];
  const editOptions: RoleRule[] = ["all", { roles: ["admin"] }, { roles: ["counsellor"] }];
  const roleSets: string[][] = [[], ["admin"], ["counsellor"], ["admin", "counsellor"]];

  for (const read of readOptions) {
    for (const edit of editOptions) {
      for (const roles of roleSets) {
        const label = `read=${JSON.stringify(read)} edit=${JSON.stringify(edit)} roles=${JSON.stringify(roles)}`;
        it(`resolves the expected access for ${label}`, () => {
          const column = makeColumn({ permissions: { read, edit } });
          const ctx: PermissionContext = { user: user(roles), column };

          const canRead = read === "all" || read.roles.some((r) => roles.includes(r));
          const canEdit = edit === "all" || edit.roles.some((r) => roles.includes(r));

          const expected = !canRead ? "hidden" : canEdit ? "edit" : "read";
          expect(resolver(ctx)).toBe(expected);
        });
      }
    }
  }

  it("when read is denied and edit is granted, the result is hidden", () => {
    const column = makeColumn({
      permissions: { read: { roles: ["admin"] }, edit: "all" },
    });
    expect(resolver({ user: user([]), column })).toBe("hidden");
  });

  it("a formula column with edit 'all' resolves to read", () => {
    const column = makeColumn({
      type: "formula",
      permissions: { read: "all", edit: "all" },
    });
    expect(resolver({ user: user([]), column })).toBe("read");
  });

  it("a column without permissions resolves to edit", () => {
    const column = makeColumn();
    column.permissions = undefined;
    expect(resolver({ user: user([]), column })).toBe("edit");
  });

  it("superRoles gets edit on a restricted column and read on a formula column", () => {
    const withSuper = createRolePermissionResolver({ superRoles: ["super"] });
    const restricted = makeColumn({
      permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } },
    });
    expect(withSuper({ user: user(["super"]), column: restricted })).toBe("edit");

    const formula = makeColumn({
      type: "formula",
      permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } },
    });
    expect(withSuper({ user: user(["super"]), column: formula })).toBe("read");
  });
});

describe("resolveColumnAccess / readableColumnIds / editableColumnIds", () => {
  const resolver = createRolePermissionResolver();

  it("returns an entry for every column id, and readableColumnIds excludes hidden ones", () => {
    const schema = makeSchema([
      makeColumn({ id: "a", key: "a" }),
      makeColumn({ id: "b", key: "b", permissions: { read: { roles: ["admin"] }, edit: "all" } }),
      makeColumn({ id: "c", key: "c", permissions: { read: "all", edit: { roles: ["admin"] } } }),
    ]);
    const access = resolveColumnAccess(schema, resolver, user([]));
    expect(access.size).toBe(3);
    expect(access.get("a")).toBe("edit");
    expect(access.get("b")).toBe("hidden");
    expect(access.get("c")).toBe("read");

    const readable = readableColumnIds(access);
    expect(readable.has("a")).toBe(true);
    expect(readable.has("b")).toBe(false);
    expect(readable.has("c")).toBe(true);

    const editable = editableColumnIds(access);
    expect(editable.has("a")).toBe(true);
    expect(editable.has("b")).toBe(false);
    expect(editable.has("c")).toBe(false);
  });

  it("calls a custom resolver once per column with the column in its context and no row", () => {
    const schema = makeSchema([
      makeColumn({ id: "a", key: "a" }),
      makeColumn({ id: "b", key: "b" }),
    ]);
    const calls: PermissionContext[] = [];
    const custom = (ctx: PermissionContext) => {
      calls.push(ctx);
      return "read" as const;
    };
    resolveColumnAccess(schema, custom, user([]));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.column.id).toBe("a");
    expect(calls[0]?.row).toBeUndefined();
    expect(calls[1]?.column.id).toBe("b");
  });

  it("caps a settable:false column at read, whatever the resolver says", () => {
    const schema = makeSchema([
      makeColumn({ id: "a", key: "a", settable: false }),
      makeColumn({ id: "b", key: "b", settable: true }),
      makeColumn({ id: "c", key: "c", settable: false, permissions: { read: { roles: ["x"] }, edit: { roles: ["x"] } } }),
    ]);
    const access = resolveColumnAccess(schema, createRolePermissionResolver(), user([]));
    expect(access.get("a")).toBe("read");
    expect(access.get("b")).toBe("edit");
    expect(access.get("c")).toBe("hidden");
    expect(editableColumnIds(access).has("a")).toBe(false);
  });
});
