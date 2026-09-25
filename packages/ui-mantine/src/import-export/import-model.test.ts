import { describe, expect, it } from "vitest";
import type { ParsedFile } from "../internal/io-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureSchema } from "../test/fixtures";
import {
  PREVIEW_ROW_LIMIT,
  buildImportPlan,
  canProceed,
  formatFileSize,
  importReducer,
  initialImportState,
  keyColumnOptions,
  mappingTargets,
  mappingErrors,
  sanitizeMapping,
  summarizePreview,
  targetColumns,
} from "./import-model";

const schema = buildFixtureSchema();
const access = buildFixtureAccess(schema);
const parsed: ParsedFile = {
  fileName: "leads.csv",
  headers: ["Payment Status", "Call Date", "Unknown"],
  rows: [["Paid", "2026-01-01", "x"]],
};

function parsedState() {
  const s1 = importReducer(initialImportState(), { type: "fileSelected", file: null, fileName: "leads.csv" });
  const s2 = importReducer(s1, {
    type: "parsed",
    parsed,
    mapping: { "Payment Status": FIXTURE_IDS.payment, "Call Date": FIXTURE_IDS.call, Unknown: null },
  });
  return importReducer(s2, { type: "goTo", step: 1 });
}

describe("import-model", () => {
  it("starts on upload with create mode and createOptions policy", () => {
    const s = initialImportState();
    expect(s.step).toBe(0);
    expect(s.mode).toBe("create");
    expect(s.unknownEnumPolicy).toBe("createOptions");
    expect(s.parsed).toBeNull();
  });

  it("target columns exclude hidden and formula columns", () => {
    const ids = targetColumns(schema, access).map((c) => c.id);
    expect(ids).toContain(FIXTURE_IDS.payment);
    expect(ids).not.toContain(FIXTURE_IDS.secret);
    expect(ids).not.toContain(FIXTURE_IDS.total);
  });

  it("key column options exclude hidden and formula columns", () => {
    const ids = keyColumnOptions(schema, access).map((c) => c.id);
    expect(ids).toContain(FIXTURE_IDS.website);
    expect(ids).not.toContain(FIXTURE_IDS.secret);
    expect(ids).not.toContain(FIXTURE_IDS.total);
  });

  it("sanitizeMapping drops targets outside the target list", () => {
    const m = sanitizeMapping(["A", "B", "C", "D"], { A: FIXTURE_IDS.payment, B: FIXTURE_IDS.total, C: FIXTURE_IDS.secret }, targetColumns(schema, access));
    expect(m).toEqual({ A: FIXTURE_IDS.payment, B: null, C: null, D: null });
  });

  it("parse clears previous state and stores the mapping", () => {
    const s = parsedState();
    expect(s.parsed).toBe(parsed);
    expect(s.mapping.Unknown).toBeNull();
    expect(s.parseError).toBeNull();
  });

  it("parse failure records the error", () => {
    const s = importReducer(initialImportState(), { type: "parseFailed", error: "Bad file" });
    expect(s.parseError).toBe("Bad file");
    expect(s.parsed).toBeNull();
  });

  it("setMapping updates one header and clears the preview", () => {
    const withPreview = importReducer(parsedState(), { type: "previewLoaded", preview: [] });
    const s = importReducer(withPreview, { type: "setMapping", header: "Unknown", columnId: FIXTURE_IDS.notes });
    expect(s.mapping.Unknown).toBe(FIXTURE_IDS.notes);
    expect(s.preview).toBeNull();
  });

  it("flags duplicate targets on every offending header", () => {
    const s = importReducer(parsedState(), { type: "setMapping", header: "Unknown", columnId: FIXTURE_IDS.payment });
    const errs = mappingErrors(s, schema, access);
    expect(Object.keys(errs.byHeader).sort()).toEqual(["Payment Status", "Unknown"]);
    expect(canProceed(s, schema, access)).toBe(false);
  });

  it("requires a key column for update and upsert", () => {
    const s = importReducer(parsedState(), { type: "setMode", mode: "upsert" });
    expect(mappingErrors(s, schema, access).keyColumn).toMatch(/key column/i);
    expect(canProceed(s, schema, access)).toBe(false);
    const withKey = importReducer(s, { type: "setKeyColumn", columnId: FIXTURE_IDS.website });
    expect(mappingErrors(withKey, schema, access).keyColumn).toBe("Map a file column to the key column");
    expect(canProceed(withKey, schema, access)).toBe(false);
    const mapped = importReducer(withKey, { type: "setMapping", header: "Unknown", columnId: FIXTURE_IDS.website });
    expect(mappingErrors(mapped, schema, access).keyColumn).toBeNull();
    expect(canProceed(mapped, schema, access)).toBe(true);
  });

  it("a read-only key column is a match-only target", () => {
    const readOnly = new Map(access);
    readOnly.set(FIXTURE_IDS.website, "read");
    expect(targetColumns(schema, readOnly).map((c) => c.id)).not.toContain(FIXTURE_IDS.website);
    let s = importReducer(parsedState(), { type: "setMode", mode: "update" });
    s = importReducer(s, { type: "setKeyColumn", columnId: FIXTURE_IDS.website });
    expect(mappingTargets(s, schema, readOnly).map((c) => c.id)).toContain(FIXTURE_IDS.website);
    s = importReducer(s, { type: "setMapping", header: "Unknown", columnId: FIXTURE_IDS.website });
    expect(mappingErrors(s, schema, readOnly).byHeader.Unknown).toBeUndefined();
    expect(canProceed(s, schema, readOnly)).toBe(true);
    // Back to create: the read-only column is no longer a valid target.
    const create = importReducer(s, { type: "setMode", mode: "create" });
    expect(mappingTargets(create, schema, readOnly).map((c) => c.id)).not.toContain(FIXTURE_IDS.website);
    expect(mappingErrors(create, schema, readOnly).byHeader.Unknown).toMatch(/cannot be imported/);
  });

  it("mappings are prototype-free records", () => {
    const m = sanitizeMapping(["constructor", "__proto__"], {}, targetColumns(schema, access));
    expect(Object.getPrototypeOf(m)).toBeNull();
    expect(m.constructor).toBeNull();
    expect(Object.keys(m)).toEqual(["constructor", "__proto__"]);
    const s = importReducer(parsedState(), { type: "setMapping", header: "__proto__", columnId: FIXTURE_IDS.notes });
    expect(Object.getPrototypeOf(s.mapping)).toBeNull();
    expect(Object.keys(s.mapping)).toContain("__proto__");
    expect(Object.getPrototypeOf(initialImportState().mapping)).toBeNull();
  });

  it("flags duplicate and blank headers", () => {
    const s1 = importReducer(initialImportState(), { type: "fileSelected", file: null, fileName: "x.csv" });
    const dupParsed: ParsedFile = { fileName: "x.csv", headers: ["Email", "Notes", "Email", "  "], rows: [] };
    let s = importReducer(s1, {
      type: "parsed",
      parsed: dupParsed,
      mapping: sanitizeMapping(dupParsed.headers, { Notes: FIXTURE_IDS.notes }, targetColumns(schema, access)),
    });
    s = importReducer(s, { type: "goTo", step: 1 });
    const errs = mappingErrors(s, schema, access);
    expect(errs.byIndex[0]).toMatch(/Duplicate header/);
    expect(errs.byIndex[2]).toMatch(/Duplicate header/);
    expect(errs.byIndex[3]).toMatch(/Blank header/);
    expect(errs.byIndex[1]).toBeUndefined();
    expect(canProceed(s, schema, access)).toBe(false);
  });

  it("create mode does not need a key column", () => {
    expect(canProceed(parsedState(), schema, access)).toBe(true);
  });

  it("requires at least one mapped column", () => {
    let s = parsedState();
    s = importReducer(s, { type: "setMapping", header: "Payment Status", columnId: null });
    s = importReducer(s, { type: "setMapping", header: "Call Date", columnId: null });
    expect(mappingErrors(s, schema, access).general).toMatch(/at least one/i);
    expect(canProceed(s, schema, access)).toBe(false);
  });

  it("cannot proceed from upload without a parsed file", () => {
    expect(canProceed(initialImportState(), schema, access)).toBe(false);
  });

  it("the plan drops the key column in create mode", () => {
    let s = importReducer(parsedState(), { type: "setMode", mode: "upsert" });
    s = importReducer(s, { type: "setKeyColumn", columnId: FIXTURE_IDS.website });
    s = importReducer(s, { type: "setMode", mode: "create" });
    expect(buildImportPlan(s)?.keyColumnId).toBeNull();
  });

  it("builds a plan from the state", () => {
    let s = parsedState();
    s = importReducer(s, { type: "setMode", mode: "update" });
    s = importReducer(s, { type: "setKeyColumn", columnId: FIXTURE_IDS.website });
    s = importReducer(s, { type: "setPolicy", policy: "rejectRows" });
    expect(buildImportPlan(s)).toEqual({
      fileName: "leads.csv",
      file: null,
      parsed,
      mapping: s.mapping,
      mode: "update",
      keyColumnId: FIXTURE_IDS.website,
      unknownEnumPolicy: "rejectRows",
    });
  });

  it("previews at most 100 rows", () => {
    expect(PREVIEW_ROW_LIMIT).toBe(100);
  });

  it("goTo moves between steps and reset returns to the start", () => {
    const s = importReducer(parsedState(), { type: "goTo", step: 2 });
    expect(s.step).toBe(2);
    expect(importReducer(s, { type: "reset" })).toEqual(initialImportState());
  });

  it("summarizes preview results", () => {
    expect(
      summarizePreview([
        { rowIndex: 0, values: {}, errors: [] },
        { rowIndex: 1, values: {}, errors: [{ columnId: "a", message: "x", kind: "unknownEnum" }, { columnId: "b", message: "y", kind: "unknownEnum" }] },
        { rowIndex: 2, values: {}, errors: [{ columnId: "a", message: "x" }] },
        { rowIndex: 3, values: {}, errors: [], rowError: "No match" },
      ]),
    ).toEqual({ valid: 1, invalid: 3, unknownEnum: 2 });
  });

  it("formats file sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
