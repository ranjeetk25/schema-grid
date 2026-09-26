import { describe, expect, it } from "vitest";
import type { Option } from "../../src/common/types";
import { createDefaultRegistry } from "../../src/field-types/default-registry";
import { validateCellValue } from "../../src/memory/mutations";
import {
  canSetOption,
  optionNotSettableMessage,
  optionRuleViolation,
  resolveSettableOptions,
} from "../../src/permissions/option-rules";
import type { ColumnDef } from "../../src/schema/types";

const admin = { id: "u1", roles: ["admin"] };
const counsellor = { id: "u2", roles: ["counsellor"] };

const options: Option[] = [
  { id: "new", label: "New" },
  { id: "verified", label: "Verified", settableBy: { roles: ["admin"] } },
  { id: "rejected", label: "Rejected", settableBy: { roles: ["admin", "finance_team"] } },
  { id: "open", label: "Open", settableBy: "all" },
];

const column = (type: ColumnDef["type"], config: unknown): ColumnDef => ({
  id: "c1",
  key: "status",
  label: "Status",
  type,
  config,
  order: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("canSetOption", () => {
  it("defaults to everyone and honours role lists", () => {
    expect(canSetOption(options[0] as Option, counsellor)).toBe(true);
    expect(canSetOption(options[3] as Option, counsellor)).toBe(true);
    expect(canSetOption(options[1] as Option, counsellor)).toBe(false);
    expect(canSetOption(options[1] as Option, admin)).toBe(true);
    expect(canSetOption(options[2] as Option, { id: "u3", roles: ["finance_team"] })).toBe(true);
  });

  it("without a user, every option is settable (no-user data sources have full access)", () => {
    expect(canSetOption(options[1] as Option, undefined)).toBe(true);
  });
});

describe("resolveSettableOptions", () => {
  it("filters select / multiSelect / creatableSelect options by the user's roles", () => {
    for (const type of ["select", "multiSelect", "creatableSelect"] as const) {
      const ids = resolveSettableOptions(column(type, { options }), counsellor).map((o) => o.id);
      expect(ids).toEqual(["new", "open"]);
      expect(resolveSettableOptions(column(type, { options }), admin).map((o) => o.id)).toEqual(["new", "verified", "rejected", "open"]);
    }
  });

  it("returns [] for other types and malformed configs", () => {
    expect(resolveSettableOptions(column("text", {}), admin)).toEqual([]);
    expect(resolveSettableOptions(column("select", { options: "nope" }), admin)).toEqual([]);
  });
});

describe("optionNotSettableMessage", () => {
  it("names the option and the roles that may set it", () => {
    expect(optionNotSettableMessage(options[1] as Option)).toBe("Option “Verified” can only be set by Admin");
    expect(optionNotSettableMessage(options[2] as Option)).toBe("Option “Rejected” can only be set by Admin or Finance team");
  });

  it("an empty role list means nobody sets it by hand (v0.3.1 copy)", () => {
    expect(optionNotSettableMessage({ id: "ai", label: "AI verified", settableBy: { roles: [] } })).toBe(
      "Option “AI verified” can’t be set manually",
    );
  });

  it("settableMessage overrides the generated copy everywhere the rule fires", () => {
    const option: Option = { id: "ai", label: "AI verified", settableBy: { roles: [] }, settableMessage: "Set by the AI pipeline" };
    expect(optionNotSettableMessage(option)).toBe("Set by the AI pipeline");
    const select = column("select", { options: [...options, option] });
    expect(optionRuleViolation(select, "ai", admin)).toBe("Set by the AI pipeline");
    expect(optionRuleViolation(select, "ai", counsellor)).toBe("Set by the AI pipeline");
  });
});

describe("optionRuleViolation", () => {
  const select = column("select", { options });
  const multi = column("multiSelect", { options });

  it("rejects a select value whose option the user cannot set", () => {
    expect(optionRuleViolation(select, "verified", counsellor)).toBe("Option “Verified” can only be set by Admin");
    expect(optionRuleViolation(select, "verified", admin)).toBeNull();
    expect(optionRuleViolation(select, "new", counsellor)).toBeNull();
    expect(optionRuleViolation(select, null, counsellor)).toBeNull();
  });

  it("only checks option ids the change introduces (existing values stay)", () => {
    expect(optionRuleViolation(select, "verified", counsellor, { prev: "verified" })).toBeNull();
    expect(optionRuleViolation(multi, ["verified", "new"], counsellor, { prev: ["verified"] })).toBeNull();
    expect(optionRuleViolation(multi, ["verified", "new"], counsellor, { prev: ["new"] })).toBe(
      "Option “Verified” can only be set by Admin",
    );
  });

  it("ignores unknown option ids (the value schema reports those) and non-option columns", () => {
    expect(optionRuleViolation(select, "ghost", counsellor)).toBeNull();
    expect(optionRuleViolation(column("text", {}), "verified", counsellor)).toBeNull();
  });

  it("skips the check without a user", () => {
    expect(optionRuleViolation(select, "verified", undefined)).toBeNull();
  });
});

describe("validateCellValue with option rules", () => {
  const registry = createDefaultRegistry();
  const select = column("select", { options });

  it("rejects a non-settable option for the user and accepts it for an allowed role", () => {
    expect(validateCellValue(select, "verified", registry, { user: counsellor })).toBe(
      "Option “Verified” can only be set by Admin",
    );
    expect(validateCellValue(select, "verified", registry, { user: admin })).toBeNull();
    expect(validateCellValue(select, "verified", registry)).toBeNull();
  });

  it("keeps an existing non-settable value when the change does not introduce it", () => {
    expect(validateCellValue(select, "verified", registry, { user: counsellor, prev: "verified" })).toBeNull();
  });
});
