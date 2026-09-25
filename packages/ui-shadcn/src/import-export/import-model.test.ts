import { describe, expect, it } from "vitest";
import type { ColumnMapping, ParsedTable, ValidationReport } from "../internal/io-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureSchema } from "../test/fixtures";
import {
  PREVIEW_ROW_LIMIT,
  buildImportPlan,
  canProceed,
  formatFileSize,
  importReducer,
  initialImportState,
  keyColumnOptions,
  mappingErrors,
  mappingTargets,
  sanitizeMapping,
  summarizePreview,
  targetColumns,
} from "./import-model";

const schema = buildFixtureSchema();
const access = buildFixtureAccess(schema);
const parsed: ParsedTable = {
  headers: ["Payment Status", "Call Date", "Unknown"],
  rows: [["Paid", "2026-01-01", "x"]],
  truncated: false,
};

const entry = (header: string, headerIndex: number, columnId: string | null): ColumnMapping => ({
  header,
  headerIndex,
  columnId,
  confidence: columnId == null ? 0 : 0.9,
});

function parsedState() {
  const s1 = importReducer(initialImportState(), { type: "fileSelected", file: null, fileName: "leads.csv" });
  const s2 = importReducer(s1, {
    type: "parsed",
    parsed,
    mapping: [entry("Payment Status", 0, FIXTURE_IDS.payment), entry("Call Date", 1, FIXTURE_IDS.call), entry("Unknown", 2, null)],
  });
  return importReducer(s2, { type: "goTo", step: 1 });
}

const target = (s: ReturnType<typeof parsedState>, i: number) => s.mapping.find((m) => m.headerIndex === i)?.columnId;

describe("import-model", () => {
  it("starts on upload with create mode and the create-options policy", () => {
    const s = initialImportState();
    expect(s.step).toBe(0);
    expect(s.mode).toBe("create");
    expect(s.unknownOptions).toBe("create");
    expect(s.parsed).toBeNull();
    expect(s.mapping).toEqual([]);
  });

  it("target columns exclude hidden and formula columns", () => {
    const ids = targetColumns(schema, access).map((c) => c.id);
    expect(ids).toContain(FIXTURE_IDS.payment);
    expect(ids).not.toContain(FIXTURE_IDS.secret);
    expect(ids).not.toContain(FIXTURE_IDS.total);
  });

  it("key column options are readable columns of a key type only", () => {
    const ids = keyColumnOptions(schema, access).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([FIXTURE_IDS.website, FIXTURE_IDS.notes]));
    expect(ids).not.toContain(FIXTURE_IDS.secret); // hidden
    expect(ids).not.toContain(FIXTURE_IDS.total); // formula
    expect(ids).not.toContain(FIXTURE_IDS.payment); // select is not a key type
    expect(ids).not.toContain(FIXTURE_IDS.call); // date
    expect(ids).not.toContain(FIXTURE_IDS.amount); // currency
  });

  it("sanitizeMapping yields one entry per header and drops targets outside the list", () => {
    const m = sanitizeMapping(
      ["A", "B", "C", "D"],
      [entry("A", 0, FIXTURE_IDS.payment), entry("B", 1, FIXTURE_IDS.total), entry("C", 2, FIXTURE_IDS.secret)],
      targetColumns(schema, access),
    );
    expect(m.map((e) => [e.header, e.headerIndex, e.columnId])).toEqual([
      ["A", 0, FIXTURE_IDS.payment],
      ["B", 1, null],
      ["C", 2, null],
      ["D", 3, null],
    ]);
    expect(m[0]?.confidence).toBe(0.9);
    expect(m[1]?.confidence).toBe(0);
  });

  it("parse stores the table and mapping", () => {
    const s = parsedState();
    expect(s.parsed).toBe(parsed);
    expect(target(s, 2)).toBeNull();
    expect(s.parseError).toBeNull();
  });

  it("parse failure records the error", () => {
    const s = importReducer(initialImportState(), { type: "parseFailed", error: "Bad file" });
    expect(s.parseError).toBe("Bad file");
    expect(s.parsed).toBeNull();
  });

  it("setMapping updates one header by index and clears the preview", () => {
    const report: ValidationReport = { rows: [], summary: { valid: 0, invalid: 0, newOptions: {}, unknownOptions: {}, unmappedRequired: [] } };
    const withPreview = importReducer(parsedState(), { type: "previewLoaded", preview: report });
    const s = importReducer(withPreview, { type: "setMapping", headerIndex: 2, columnId: FIXTURE_IDS.notes });
    expect(s.mapping[2]).toEqual({ header: "Unknown", headerIndex: 2, columnId: FIXTURE_IDS.notes, confidence: 1 });
    expect(s.preview).toBeNull();
    const skipped = importReducer(s, { type: "setMapping", headerIndex: 0, columnId: null });
    expect(skipped.mapping[0]).toMatchObject({ columnId: null, confidence: 0 });
  });

  it("flags duplicate targets on every offending header", () => {
    const s = importReducer(parsedState(), { type: "setMapping", headerIndex: 2, columnId: FIXTURE_IDS.payment });
    const errs = mappingErrors(s, schema, access);
    expect(Object.keys(errs.byIndex).sort()).toEqual(["0", "2"]);
    expect(errs.byIndex[0]).toMatch(/Duplicate target: Payment status/);
    expect(canProceed(s, schema, access)).toBe(false);
  });

  it("requires a mapped key column for update and upsert", () => {
    const s = importReducer(parsedState(), { type: "setMode", mode: "upsert" });
    expect(mappingErrors(s, schema, access).keyColumn).toBe("A key column is required for update and upsert");
    expect(canProceed(s, schema, access)).toBe(false);
    const withKey = importReducer(s, { type: "setKeyColumn", columnId: FIXTURE_IDS.website });
    expect(mappingErrors(withKey, schema, access).keyColumn).toBe("Map a file column to the key column");
    expect(canProceed(withKey, schema, access)).toBe(false);
    const mapped = importReducer(withKey, { type: "setMapping", headerIndex: 2, columnId: FIXTURE_IDS.website });
    expect(mappingErrors(mapped, schema, access).keyColumn).toBeNull();
    expect(canProceed(mapped, schema, access)).toBe(true);
  });

  it("rejects a key column of a non-key type", () => {
    let s = importReducer(parsedState(), { type: "setMode", mode: "update" });
    s = importReducer(s, { type: "setKeyColumn", columnId: FIXTURE_IDS.payment });
    expect(mappingErrors(s, schema, access).keyColumn).toBe("This column cannot be used as a key");
  });

  it("a read-only key column is a match-only target", () => {
    const readOnly = new Map(access);
    readOnly.set(FIXTURE_IDS.website, "read");
    expect(targetColumns(schema, readOnly).map((c) => c.id)).not.toContain(FIXTURE_IDS.website);
    let s = importReducer(parsedState(), { type: "setMode", mode: "update" });
    s = importReducer(s, { type: "setKeyColumn", columnId: FIXTURE_IDS.website });
    expect(mappingTargets(s, schema, readOnly).map((c) => c.id)).toContain(FIXTURE_IDS.website);
    s = importReducer(s, { type: "setMapping", headerIndex: 2, columnId: FIXTURE_IDS.website });
    expect(mappingErrors(s, schema, readOnly).byIndex[2]).toBeUndefined();
    expect(canProceed(s, schema, readOnly)).toBe(true);
    // Back to create: the read-only column is no longer a valid target.
    const create = importReducer(s, { type: "setMode", mode: "create" });
    expect(mappingTargets(create, schema, readOnly).map((c) => c.id)).not.toContain(FIXTURE_IDS.website);
    expect(mappingErrors(create, schema, readOnly).byIndex[2]).toMatch(/cannot be imported/);
  });

  it("headers like __proto__ and constructor are ordinary entries", () => {
    const m = sanitizeMapping(["constructor", "__proto__"], [], targetColumns(schema, access));
    expect(m.map((e) => e.header)).toEqual(["constructor", "__proto__"]);
    expect(m.every((e) => e.columnId === null)).toBe(true);
  });

  it("flags duplicate and blank headers", () => {
    const s1 = importReducer(initialImportState(), { type: "fileSelected", file: null, fileName: "x.csv" });
    const dupParsed: ParsedTable = { headers: ["Email", "Notes", "Email", "  "], rows: [], truncated: false };
    let s = importReducer(s1, {
      type: "parsed",
      parsed: dupParsed,
      mapping: sanitizeMapping(dupParsed.headers, [entry("Notes", 1, FIXTURE_IDS.notes)], targetColumns(schema, access)),
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
    s = importReducer(s, { type: "setMapping", headerIndex: 0, columnId: null });
    s = importReducer(s, { type: "setMapping", headerIndex: 1, columnId: null });
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
    s = importReducer(s, { type: "setPolicy", policy: "reject" });
    expect(buildImportPlan(s)).toEqual({
      fileName: "leads.csv",
      file: null,
      parsed,
      mapping: s.mapping,
      mode: "update",
      keyColumnId: FIXTURE_IDS.website,
      unknownOptions: "reject",
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

  it("summarizes a report: counts from the summary, unknown values from summary.unknownOptions (either policy)", () => {
    const report: ValidationReport = {
      rows: [
        { index: 0, sourceRow: 2, cells: { a: { value: "x", raw: "x" } } },
        {
          index: 1,
          sourceRow: 3,
          cells: { a: { value: null, raw: "Zed", error: 'Unknown option "Zed"', errorKind: "unknownOption" } },
        },
        { index: 2, sourceRow: 4, cells: { a: { value: null, raw: "q", error: "Invalid date", errorKind: "parse" } } },
      ],
      // Reject policy: newOptions is empty, unknownOptions still lists every unknown label.
      summary: { valid: 1, invalid: 2, newOptions: {}, unknownOptions: { a: ["Zed"], b: ["One", "Two"] }, unmappedRequired: [] },
    };
    expect(summarizePreview(report)).toEqual({ valid: 1, invalid: 2, unknownOptions: 3 });
  });

  it("never parses error messages: an 'Unknown option…' message without the summary entry is not counted", () => {
    const report: ValidationReport = {
      rows: [{ index: 0, sourceRow: 2, cells: { a: { value: null, raw: "q", error: "Unknown option-ish parse error", errorKind: "parse" } } }],
      summary: { valid: 0, invalid: 1, newOptions: {}, unknownOptions: {}, unmappedRequired: [] },
    };
    expect(summarizePreview(report).unknownOptions).toBe(0);
  });

  it("formats file sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
