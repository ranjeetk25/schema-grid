import { describe, expect, it } from "vitest";
import {
  BOOLEAN_OPERATORS,
  DATE_OPERATORS,
  findOperator,
  isNegativeOperator,
  LINK_OPERATORS,
  MULTI_SELECT_OPERATORS,
  NEGATIVE_OPERATOR_IDS,
  NUMBER_OPERATORS,
  SELECT_OPERATORS,
  TEXT_OPERATORS,
  USER_OPERATORS,
  type FilterOperatorDef,
} from "../../src/filter/operators";

function ids(defs: readonly FilterOperatorDef[]): string[] {
  return defs.map((d) => d.id);
}

describe("operator catalog: id order matches spec 4.3", () => {
  it("TEXT_OPERATORS", () => {
    expect(ids(TEXT_OPERATORS)).toEqual([
      "contains",
      "notContains",
      "startsWith",
      "is",
      "isNot",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  it("NUMBER_OPERATORS", () => {
    expect(ids(NUMBER_OPERATORS)).toEqual([
      "eq",
      "neq",
      "lt",
      "lte",
      "gt",
      "gte",
      "between",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  it("DATE_OPERATORS", () => {
    expect(ids(DATE_OPERATORS)).toEqual([
      "is",
      "isBefore",
      "isAfter",
      "isBetween",
      "isWithin",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  it("SELECT_OPERATORS", () => {
    expect(ids(SELECT_OPERATORS)).toEqual([
      "is",
      "isNot",
      "isAnyOf",
      "isNoneOf",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  it("USER_OPERATORS is select operators plus isMe and isNotMe", () => {
    expect(ids(USER_OPERATORS)).toEqual([
      "is",
      "isNot",
      "isAnyOf",
      "isNoneOf",
      "isEmpty",
      "isNotEmpty",
      "isMe",
      "isNotMe",
    ]);
  });

  it("MULTI_SELECT_OPERATORS", () => {
    expect(ids(MULTI_SELECT_OPERATORS)).toEqual([
      "hasAnyOf",
      "hasAllOf",
      "hasNoneOf",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  it("BOOLEAN_OPERATORS", () => {
    expect(ids(BOOLEAN_OPERATORS)).toEqual(["isTrue", "isFalse"]);
  });

  it("LINK_OPERATORS", () => {
    expect(ids(LINK_OPERATORS)).toEqual(["is", "isAnyOf", "isEmpty", "isNotEmpty"]);
  });
});

describe("frozen arrays", () => {
  it("every exported operator array is frozen", () => {
    for (const arr of [
      TEXT_OPERATORS,
      NUMBER_OPERATORS,
      DATE_OPERATORS,
      SELECT_OPERATORS,
      USER_OPERATORS,
      MULTI_SELECT_OPERATORS,
      BOOLEAN_OPERATORS,
      LINK_OPERATORS,
    ]) {
      expect(Object.isFrozen(arr)).toBe(true);
    }
  });
});

describe("negative flags", () => {
  it("NEGATIVE_OPERATOR_IDS contains exactly the spec's negative ids", () => {
    expect(NEGATIVE_OPERATOR_IDS).toEqual(
      new Set(["isNot", "isNoneOf", "notContains", "neq", "hasNoneOf", "isNotMe"]),
    );
  });

  it("every operator in NEGATIVE_OPERATOR_IDS has negative:true in every set where it appears", () => {
    const allSets = [
      TEXT_OPERATORS,
      NUMBER_OPERATORS,
      DATE_OPERATORS,
      SELECT_OPERATORS,
      USER_OPERATORS,
      MULTI_SELECT_OPERATORS,
      BOOLEAN_OPERATORS,
      LINK_OPERATORS,
    ];
    for (const set of allSets) {
      for (const def of set) {
        if (NEGATIVE_OPERATOR_IDS.has(def.id)) {
          expect(def.negative).toBe(true);
        }
      }
    }
  });

  it("no operator outside NEGATIVE_OPERATOR_IDS is flagged negative", () => {
    const allSets = [
      TEXT_OPERATORS,
      NUMBER_OPERATORS,
      DATE_OPERATORS,
      SELECT_OPERATORS,
      USER_OPERATORS,
      MULTI_SELECT_OPERATORS,
      BOOLEAN_OPERATORS,
      LINK_OPERATORS,
    ];
    for (const set of allSets) {
      for (const def of set) {
        if (!NEGATIVE_OPERATOR_IDS.has(def.id)) {
          expect(def.negative).not.toBe(true);
        }
      }
    }
  });

  it("isEmpty is not negative", () => {
    const def = findOperator(TEXT_OPERATORS, "isEmpty");
    expect(def?.negative).not.toBe(true);
  });

  it("isFalse is not negative", () => {
    const def = findOperator(BOOLEAN_OPERATORS, "isFalse");
    expect(def?.negative).not.toBe(true);
  });
});

describe("value kinds", () => {
  it("isWithin has valueKind relativeDate", () => {
    expect(findOperator(DATE_OPERATORS, "isWithin")?.valueKind).toBe("relativeDate");
  });

  it("between and isBetween are range", () => {
    expect(findOperator(NUMBER_OPERATORS, "between")?.valueKind).toBe("range");
    expect(findOperator(DATE_OPERATORS, "isBetween")?.valueKind).toBe("range");
  });

  it("isMe is me", () => {
    expect(findOperator(USER_OPERATORS, "isMe")?.valueKind).toBe("me");
  });

  it("isEmpty is none", () => {
    expect(findOperator(TEXT_OPERATORS, "isEmpty")?.valueKind).toBe("none");
  });
});

describe("isNegativeOperator", () => {
  it("isNegativeOperator('isNot') is true", () => {
    expect(isNegativeOperator("isNot")).toBe(true);
  });

  it("isNegativeOperator('is') is false", () => {
    expect(isNegativeOperator("is")).toBe(false);
  });
});

describe("findOperator", () => {
  it("returns undefined for an id not in the set", () => {
    expect(findOperator(TEXT_OPERATORS, "isTrue")).toBeUndefined();
  });
});
