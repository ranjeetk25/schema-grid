import { describe, expect, it } from "vitest";
import { autoMapColumns } from "../src/import/auto-map";
import { isAbbreviation, levenshtein, normalizeLabel, tokenize } from "../src/import/normalize";
import { makeAccess, makeColumns, makeSchema } from "./helpers/schema";

function mappingFor(headers: string[], overrides: Parameters<typeof autoMapColumns>[3] = {}) {
  return autoMapColumns(headers, makeSchema(), makeAccess(), overrides);
}

function columnIdFor(headers: string[], header: string, overrides?: Parameters<typeof autoMapColumns>[3]) {
  const mapping = mappingFor(headers, overrides);
  const entry = mapping.find((m) => m.header === header);
  if (!entry) throw new Error(`No mapping entry for header ${header}`);
  return entry;
}

describe("normalize helpers", () => {
  it("tokenize splits camelCase, acronyms, punctuation and digit boundaries", () => {
    expect(tokenize("paymentStatus")).toEqual(["payment", "status"]);
    expect(tokenize("HTTPServer")).toEqual(["http", "server"]);
    expect(tokenize("payment_status")).toEqual(["payment", "status"]);
    expect(tokenize("PAYMENT-STATUS")).toEqual(["payment", "status"]);
    expect(tokenize("Order2Ship")).toEqual(["order", "2", "ship"]);
    expect(tokenize("")).toEqual([]);
  });

  it("normalizeLabel strips accents, case and non alphanumerics", () => {
    expect(normalizeLabel("Payment Status")).toBe("paymentstatus");
    expect(normalizeLabel("payment_status")).toBe("paymentstatus");
    expect(normalizeLabel("PAYMENT-STATUS")).toBe("paymentstatus");
    expect(normalizeLabel("Café")).toBe("cafe");
  });

  it("levenshtein computes basic edit distances", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("emial", "email")).toBe(1); // adjacent transposition
    expect(levenshtein("ca", "abc")).toBe(3); // OSA, not full Damerau
    expect(levenshtein("ab", "ba", 1)).toBe(1);
    expect(levenshtein("abcd", "badc", 2)).toBe(2);
  });

  it("levenshtein returns early past max without computing the exact distance", () => {
    expect(levenshtein("abcdef", "zzzzzzzz", 2)).toBeGreaterThan(2);
    expect(levenshtein("kitten", "sitting", 1)).toBeGreaterThan(1);
    expect(levenshtein("kitten", "sitting", 5)).toBe(3);
  });

  it("isAbbreviation matches in-order prefixed letters", () => {
    expect(isAbbreviation("pymt", "payment")).toBe(true);
    expect(isAbbreviation("py", "payment")).toBe(false); // too short
    expect(isAbbreviation("xyz", "payment")).toBe(false); // wrong first letter
    expect(isAbbreviation("pmy", "payment")).toBe(false); // out of order
  });
});

describe("autoMapColumns", () => {
  it("maps an exact label match with confidence exactly 1", () => {
    const entry = columnIdFor(["Payment Status"], "Payment Status");
    expect(entry.columnId).toBe("c_pay");
    expect(entry.confidence).toBe(1);
  });

  it("maps normalised key variants (snake_case, kebab-case) at confidence 1", () => {
    expect(columnIdFor(["payment_status"], "payment_status")).toMatchObject({
      columnId: "c_pay",
      confidence: 1,
    });
    expect(columnIdFor(["PAYMENT-STATUS"], "PAYMENT-STATUS")).toMatchObject({
      columnId: "c_pay",
      confidence: 1,
    });
  });

  it("maps an abbreviated header via word-by-word scoring, below full confidence", () => {
    const entry = columnIdFor(["Pymt Status"], "Pymt Status");
    expect(entry.columnId).toBe("c_pay");
    expect(entry.confidence).toBeGreaterThan(0.6);
    expect(entry.confidence).toBeLessThan(1);
  });

  it("maps a misspelled header via whole-string Levenshtein, below full confidence", () => {
    // Transposition counts as one edit: 0.95 * (1 - 1/5) = 0.76.
    const entry = columnIdFor(["Emial"], "Emial");
    expect(entry.confidence).toBeCloseTo(0.76);
    expect(entry.columnId).toBe("c_email");
    expect(entry.confidence).toBeLessThan(1);
    expect(entry.confidence).toBeGreaterThan(0);
  });

  it("never maps to a hidden column, even on an exact match", () => {
    const entry = columnIdFor(["Secret"], "Secret");
    expect(entry.columnId).toBeNull();
    expect(entry.confidence).toBe(0);
  });

  it("never maps to a read-only column", () => {
    const entry = columnIdFor(["Note"], "Note");
    expect(entry.columnId).toBeNull();
    expect(entry.confidence).toBe(0);
  });

  it("never maps to a formula column", () => {
    const entry = columnIdFor(["Score"], "Score");
    expect(entry.columnId).toBeNull();
    expect(entry.confidence).toBe(0);
  });

  it("assigns the column to the higher scoring header when two compete", () => {
    const mapping = mappingFor(["Payment Status", "Pymt Status"]);
    const exact = mapping.find((m) => m.header === "Payment Status");
    const fuzzy = mapping.find((m) => m.header === "Pymt Status");
    expect(exact?.columnId).toBe("c_pay");
    expect(exact?.confidence).toBe(1);
    expect(fuzzy?.columnId).toBeNull();
    expect(fuzzy?.confidence).toBe(0);
  });

  it("leaves an unrelated header unmapped with confidence 0", () => {
    const entry = columnIdFor(["Zzz"], "Zzz");
    expect(entry.columnId).toBeNull();
    expect(entry.confidence).toBe(0);
  });

  it("does not map short, noisy headers like 'A' or 'Id'", () => {
    const mapping = mappingFor(["A", "Id"]);
    for (const entry of mapping) {
      expect(entry.columnId).toBeNull();
      expect(entry.confidence).toBe(0);
    }
  });

  it("does not confuse near-miss real-world headers at the default threshold", () => {
    const TS = "2026-09-01T00:00:00.000Z";
    const extra = (id: string, key: string, label: string) => ({
      id,
      key,
      label,
      type: "text",
      config: {},
      order: 99,
      createdAt: TS,
      updatedAt: TS,
    });
    const columns = [
      extra("x_state", "state", "State"),
      extra("x_source", "source", "Source"),
      extra("x_date", "date", "Date"),
      extra("x_age", "age", "Age"),
      extra("x_contact", "contact", "Contact"),
      extra("x_branch", "branch", "Branch"),
    ];
    const access = new Map(columns.map((c) => [c.id, "edit" as const]));
    for (const header of ["Status", "Course", "Data", "Average", "Batch", "Rate"]) {
      const [entry] = autoMapColumns([header], columns, access);
      expect(entry?.columnId, header).toBeNull();
    }
  });

  it("does not give 'Status' alone a perfect match against Payment Status", () => {
    const entry = columnIdFor(["Status"], "Status", { minConfidence: 0.01 });
    expect(entry.confidence).toBeLessThan(1);
  });

  it("minConfidence 0 still never assigns a zero-score header", () => {
    const entry = columnIdFor(["Zzz"], "Zzz", { minConfidence: 0 });
    expect(entry.columnId).toBeNull();
    expect(entry.confidence).toBe(0);
  });

  it("a raised minConfidence drops fuzzy matches but keeps exact ones", () => {
    const mapping = mappingFor(["Pymt Status", "Email"], { minConfidence: 0.95 });
    expect(mapping[0]?.columnId).toBeNull();
    expect(mapping[1]?.columnId).toBe("c_email");
  });

  it("equal scores: the earlier header wins", () => {
    const mapping = mappingFor(["Email", "email"]);
    expect(mapping[0]?.columnId).toBe("c_email");
    expect(mapping[1]?.columnId).toBeNull();
  });

  it("a column missing from the access map is never a candidate", () => {
    const access = makeAccess();
    access.delete("c_email");
    const [entry] = autoMapColumns(["Email"], makeSchema(), access);
    expect(entry?.columnId).toBeNull();
  });

  it("matches on key alone at 1.0", () => {
    const entry = columnIdFor(["joined_on"], "joined_on");
    expect(entry.columnId).toBe("c_joined");
    expect(entry.confidence).toBe(1);
  });

  it("a repeated header word cannot cover two column words", () => {
    const entry = columnIdFor(["Status Status"], "Status Status");
    expect(entry.columnId === "c_pay" ? entry.confidence : 0).toBeLessThan(0.6);
  });

  it("keeps header order and includes headerIndex in the output", () => {
    const mapping = mappingFor(["Zzz", "Payment Status", "Email"]);
    expect(mapping.map((m) => m.header)).toEqual(["Zzz", "Payment Status", "Email"]);
    expect(mapping.map((m) => m.headerIndex)).toEqual([0, 1, 2]);
  });

  it("accepts a bare ColumnDef[] as well as a GridSchema", () => {
    const mapping = autoMapColumns(["Payment Status"], makeColumns(), makeAccess());
    expect(mapping[0]?.columnId).toBe("c_pay");
    expect(mapping[0]?.confidence).toBe(1);
  });
});
