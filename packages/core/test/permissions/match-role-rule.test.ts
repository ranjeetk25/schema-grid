import { describe, expect, it } from "vitest";
import { matchesRoleRule } from "../../src/permissions/match-role-rule";
import { createRolePermissionResolver } from "../../src/permissions/role-resolver";
import type { ColumnDef, RoleRule } from "../../src/schema/types";

const priya = { id: "priya", roles: ["counsellor"] };
const rahul = { id: "rahul", roles: [] };
const boss = { id: "boss", roles: ["super"] };

describe("matchesRoleRule", () => {
  it('"all" matches everyone', () => {
    expect(matchesRoleRule("all", rahul)).toBe(true);
  });

  it("matches on any listed role OR the user's id", () => {
    const rule: RoleRule = { roles: ["finance_team"], users: ["priya"] };
    expect(matchesRoleRule(rule, priya)).toBe(true);
    expect(matchesRoleRule(rule, { id: "x", roles: ["finance_team"] })).toBe(true);
    expect(matchesRoleRule(rule, rahul)).toBe(false);
  });

  it("a users-only rule (roles absent) matches listed ids only", () => {
    expect(matchesRoleRule({ users: ["rahul"] }, rahul)).toBe(true);
    expect(matchesRoleRule({ users: ["rahul"] }, priya)).toBe(false);
  });

  it("{} and empty lists match nobody", () => {
    expect(matchesRoleRule({}, priya)).toBe(false);
    expect(matchesRoleRule({ roles: [], users: [] }, priya)).toBe(false);
  });

  it("superRoles bypass any rule", () => {
    expect(matchesRoleRule({}, boss, ["super"])).toBe(true);
    expect(matchesRoleRule({ users: ["priya"] }, boss, ["super"])).toBe(true);
    expect(matchesRoleRule({ users: ["priya"] }, boss)).toBe(false);
  });
});

describe("createRolePermissionResolver — per-user rules", () => {
  const column = (permissions: ColumnDef["permissions"]): ColumnDef => ({
    id: "fee",
    key: "fee",
    label: "Fee",
    type: "number",
    config: {},
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    permissions,
  });

  it("grants edit to a listed user and read to the rest", () => {
    const resolver = createRolePermissionResolver();
    const col = column({ read: "all", edit: { roles: ["admin"], users: ["priya"] } });
    expect(resolver({ user: priya, column: col })).toBe("edit");
    expect(resolver({ user: rahul, column: col })).toBe("read");
  });

  it("hides a users-only read rule from people not listed", () => {
    const resolver = createRolePermissionResolver({ superRoles: ["super"] });
    const col = column({ read: { users: ["priya"] }, edit: { users: ["priya"] } });
    expect(resolver({ user: priya, column: col })).toBe("edit");
    expect(resolver({ user: rahul, column: col })).toBe("hidden");
    expect(resolver({ user: boss, column: col })).toBe("edit");
  });
});
