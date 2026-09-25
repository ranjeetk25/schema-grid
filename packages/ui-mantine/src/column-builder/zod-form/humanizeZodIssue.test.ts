import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldNameForPath, humanizeZodIssue, isPathTouched, zodIssuesToErrors } from "./humanizeZodIssue";

const issuesOf = (schema: z.ZodTypeAny, value: unknown) => {
  const r = schema.safeParse(value);
  if (r.success) throw new Error("expected a failure");
  return r.error.issues;
};

const firstIssue = (schema: z.ZodTypeAny, value: unknown) => {
  const [issue] = issuesOf(schema, value);
  if (!issue) throw new Error("expected an issue");
  return issue;
};

const RAW = /character\(s\)|Expected|Required$|Invalid (enum|input|type)|received/;

describe("humanizeZodIssue", () => {
  it("an empty option name reads 'Option name is required' (not the raw Zod text)", () => {
    const schema = z.object({ options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })) });
    const issue = firstIssue(schema, { options: [{ id: "a", label: "" }] });
    expect(issue.path).toEqual(["options", 0, "label"]);
    expect(humanizeZodIssue(issue)).toBe("Option name is required");
  });

  it.each([
    ["string min 3", z.object({ code: z.string().min(3) }), { code: "ab" }, "Code needs at least 3 characters"],
    ["string max", z.object({ code: z.string().max(2) }), { code: "abc" }, "Code can be at most 2 characters"],
    ["number min", z.object({ maxLength: z.number().min(1) }), { maxLength: 0 }, "Max length must be 1 or more"],
    ["number gt", z.object({ step: z.number().gt(0) }), { step: 0 }, "Step must be more than 0"],
    ["number max", z.object({ precision: z.number().max(4) }), { precision: 9 }, "Precision must be 4 or less"],
    ["array min 1", z.object({ options: z.array(z.string()).min(1) }), { options: [] }, "Add at least one option"],
    ["missing", z.object({ currency: z.string() }), {}, "Currency is required"],
    ["wrong type", z.object({ precision: z.number() }), { precision: "x" }, "Precision must be a number"],
    ["enum", z.object({ unit: z.enum(["days", "weeks"]) }), { unit: "years" }, "Choose one of: days, weeks"],
    ["email", z.object({ from: z.string().email() }), { from: "nope" }, "Enter a valid email address"],
    ["url", z.object({ link: z.string().url() }), { link: "nope" }, "Enter a valid URL, e.g. https://example.com"],
    ["int", z.object({ count: z.number().int() }), { count: 1.5 }, "Count must be a whole number"],
  ])("%s", (_name, schema, value, expected) => {
    const message = humanizeZodIssue(firstIssue(schema, value));
    expect(message).toBe(expected);
    expect(message).not.toMatch(RAW);
  });

  it("keeps a refinement's own (author-written) message", () => {
    const schema = z.object({ options: z.array(z.string()) }).refine(() => false, { message: "Option ids must be unique" });
    expect(humanizeZodIssue(firstIssue(schema, { options: [] }))).toBe("Option ids must be unique");
  });

  it("understands v4-shaped issues too (origin / invalid_value / invalid_format)", () => {
    expect(humanizeZodIssue({ code: "too_small", origin: "string", minimum: 1, path: ["options", 2, "label"] })).toBe(
      "Option name is required",
    );
    expect(humanizeZodIssue({ code: "invalid_value", values: ["a", "b"], path: ["unit"] })).toBe("Choose one of: a, b");
    expect(humanizeZodIssue({ code: "invalid_format", format: "email", path: ["from"] })).toBe("Enter a valid email address");
    expect(humanizeZodIssue({ code: "invalid_type", expected: "number", input: undefined, path: ["max"] })).toBe("Max is required");
  });

  it("names fields from the path; the whole object is 'This setting'", () => {
    expect(fieldNameForPath(["options", 0, "id"])).toBe("Option id");
    expect(fieldNameForPath(["options", 0, "color"])).toBe("Colour");
    expect(fieldNameForPath(["dateFormat"])).toBe("Date format");
    expect(fieldNameForPath([])).toBe("This setting");
    expect(humanizeZodIssue({ code: "something_new", path: [] })).toBe("This setting isn't valid");
  });
});

describe("zodIssuesToErrors", () => {
  it("maps dot-paths to the first friendly message per path", () => {
    const schema = z.object({ options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })) });
    const errors = zodIssuesToErrors(issuesOf(schema, { options: [{ id: "", label: "" }, { id: "b", label: "B" }] }));
    expect(errors).toEqual({ "options.0.id": "Option id is required", "options.0.label": "Option name is required" });
  });
});

describe("isPathTouched", () => {
  it("matches the path itself, or any field in the same list row", () => {
    const touched = new Set(["options.2.label", "maxLength"]);
    expect(isPathTouched("maxLength", touched)).toBe(true);
    expect(isPathTouched("options.2.id", touched)).toBe(true);
    expect(isPathTouched("options.1.id", touched)).toBe(false);
    expect(isPathTouched("options", touched)).toBe(false);
    expect(isPathTouched("minLength", touched)).toBe(false);
  });
});
