import { describe, expect, it } from "vitest";
import type { FilterNode } from "../internal/core-contracts";
import { columnColorFilter, setColumnColorFilter } from "./colorFilter";

const status = { columnId: "status", operator: "is", value: "paid" };

describe("setColumnColorFilter", () => {
  it("adds a colorIs condition to an empty filter (AND root)", () => {
    expect(setColumnColorFilter(null, "fee", ["red", "blue"])).toEqual({
      op: "and",
      children: [
        { columnId: "fee", operator: "colorIs", value: ["red", "blue"] },
      ],
    });
  });

  it("ANDs it onto a bare condition and onto an AND root", () => {
    expect(setColumnColorFilter(status, "fee", ["red"])).toEqual({
      op: "and",
      children: [
        status,
        { columnId: "fee", operator: "colorIs", value: ["red"] },
      ],
    });
    const root: FilterNode = { op: "and", children: [status] };
    expect(setColumnColorFilter(root, "fee", "none")).toEqual({
      op: "and",
      children: [status, { columnId: "fee", operator: "colorIsNone" }],
    });
  });

  it("wraps an OR root instead of changing its meaning", () => {
    const or: FilterNode = {
      op: "or",
      children: [status, { columnId: "fee", operator: "isEmpty" }],
    };
    expect(setColumnColorFilter(or, "fee", ["green"])).toEqual({
      op: "and",
      children: [
        or,
        { columnId: "fee", operator: "colorIs", value: ["green"] },
      ],
    });
  });

  it("replaces the column's top-level color condition (other columns keep theirs)", () => {
    const root: FilterNode = {
      op: "and",
      children: [
        status,
        { columnId: "fee", operator: "colorIs", value: ["red"] },
        { columnId: "name", operator: "colorIs", value: ["blue"] },
      ],
    };
    expect(setColumnColorFilter(root, "fee", ["yellow"])).toEqual({
      op: "and",
      children: [
        status,
        { columnId: "name", operator: "colorIs", value: ["blue"] },
        { columnId: "fee", operator: "colorIs", value: ["yellow"] },
      ],
    });
  });

  it("null clears the column's color condition; an emptied filter becomes null", () => {
    const root: FilterNode = {
      op: "and",
      children: [{ columnId: "fee", operator: "colorIsNone" }],
    };
    expect(setColumnColorFilter(root, "fee", null)).toBeNull();
    expect(
      setColumnColorFilter(
        {
          op: "and",
          children: [status, { columnId: "fee", operator: "colorIsNone" }],
        },
        "fee",
        null,
      ),
    ).toEqual({
      op: "and",
      children: [status],
    });
  });

  it("an empty color list clears too", () => {
    expect(
      setColumnColorFilter(
        {
          op: "and",
          children: [{ columnId: "fee", operator: "colorIs", value: ["red"] }],
        },
        "fee",
        [],
      ),
    ).toBeNull();
  });
});

describe("columnColorFilter", () => {
  it("reads the column's top-level color condition", () => {
    const root: FilterNode = {
      op: "and",
      children: [
        status,
        { columnId: "fee", operator: "colorIs", value: ["red", "nope"] },
        { columnId: "name", operator: "colorIsNone" },
      ],
    };
    expect(columnColorFilter(root, "fee")).toEqual(["red"]);
    expect(columnColorFilter(root, "name")).toBe("none");
    expect(columnColorFilter(root, "status")).toBeNull();
    expect(columnColorFilter(null, "fee")).toBeNull();
    expect(
      columnColorFilter(
        { op: "or", children: [{ columnId: "fee", operator: "colorIsNone" }] },
        "fee",
      ),
    ).toBeNull();
  });
});
