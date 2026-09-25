import { FORMULA_FUNCTIONS, type GridSchema } from "../internal/core-contracts";

export interface FormulaFunctionDoc {
  name: string;
  signature: string;
  description: string;
}

/** Signatures + one-liners for core's function library (UI copy; core has only names and arity). */
const DOCS: Record<string, { signature: string; description: string }> = {
  IF: { signature: "IF(condition, then, else)", description: "Pick a value based on a condition" },
  AND: { signature: "AND(a, b, …)", description: "True when every argument is true" },
  OR: { signature: "OR(a, b, …)", description: "True when any argument is true" },
  NOT: { signature: "NOT(value)", description: "Flip true and false" },
  SUM: { signature: "SUM(a, b, …)", description: "Add numbers" },
  AVG: { signature: "AVG(a, b, …)", description: "Average of numbers" },
  MIN: { signature: "MIN(a, b, …)", description: "Smallest number" },
  MAX: { signature: "MAX(a, b, …)", description: "Largest number" },
  ROUND: { signature: "ROUND(number, digits)", description: "Round to a number of decimal places" },
  ABS: { signature: "ABS(number)", description: "Absolute value" },
  CONCAT: { signature: "CONCAT(a, b, …)", description: "Join text together" },
  UPPER: { signature: "UPPER(text)", description: "Text in capitals" },
  LOWER: { signature: "LOWER(text)", description: "Text in lower case" },
  TRIM: { signature: "TRIM(text)", description: "Remove spaces at both ends" },
  LEN: { signature: "LEN(text)", description: "Number of characters" },
  LEFT: { signature: "LEFT(text, count)", description: "First characters of the text" },
  RIGHT: { signature: "RIGHT(text, count)", description: "Last characters of the text" },
  TODAY: { signature: "TODAY()", description: "Today's date" },
  NOW: { signature: "NOW()", description: "The current date and time" },
  DATEADD: { signature: 'DATEADD(date, amount, "days")', description: "Move a date by days, months or years" },
  DATEDIFF: { signature: 'DATEDIFF(start, end, "days")', description: "Time between two dates" },
  YEAR: { signature: "YEAR(date)", description: "Year of a date" },
  MONTH: { signature: "MONTH(date)", description: "Month number of a date" },
  DAY: { signature: "DAY(date)", description: "Day of the month" },
  IS_EMPTY: { signature: "IS_EMPTY(value)", description: "True when the value is blank" },
  COALESCE: { signature: "COALESCE(a, b, …)", description: "First value that isn't blank" },
};

/** Every function core evaluates, with a signature and a one-line description. */
export function formulaFunctionDocs(): FormulaFunctionDoc[] {
  return [...FORMULA_FUNCTIONS.values()].map((fn) => {
    const doc = DOCS[fn.name];
    if (doc) return { name: fn.name, ...doc };
    const args = fn.maxArgs === 0 ? "" : fn.maxArgs === Number.POSITIVE_INFINITY ? "…" : Array.from({ length: fn.maxArgs }, (_, i) => `arg${i + 1}`).join(", ");
    return { name: fn.name, signature: `${fn.name}(${args})`, description: "" };
  });
}

export interface FormulaExample {
  label: string;
  formula: string;
}

const NUMERIC = new Set(["number", "currency"]);
const DATES = new Set(["date", "datetime"]);
const SELECTS = new Set(["select", "creatableSelect"]);
const TEXTS = new Set(["text", "email", "phone", "url"]);

const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/**
 * Two or three example formulas built from the schema's own columns (so each
 * one is valid here): arithmetic on two numbers, a condition on a select,
 * days since a date, or text joining — whichever the columns allow.
 */
export function formulaExamples(schema: GridSchema, readableKeys: ReadonlySet<string>, selfKey?: string): FormulaExample[] {
  const cols = schema.columns.filter((c) => readableKeys.has(c.key) && c.key !== selfKey && c.type !== "formula");
  const numbers = cols.filter((c) => NUMERIC.has(c.type));
  const dates = cols.filter((c) => DATES.has(c.type));
  const selects = cols.filter((c) => SELECTS.has(c.type));
  const texts = cols.filter((c) => TEXTS.has(c.type));
  const out: FormulaExample[] = [];
  const [n1, n2] = numbers;
  if (n1 && n2) out.push({ label: `${n1.label} minus ${n2.label}`, formula: `{${n1.key}} - {${n2.key}}` });
  else if (n1) out.push({ label: `${n1.label} with 18% added`, formula: `ROUND({${n1.key}} * 1.18, 2)` });
  const sel = selects[0];
  const firstOption = sel ? (sel.config as { options?: { label?: unknown }[] } | null)?.options?.[0]?.label : undefined;
  if (sel && typeof firstOption === "string") {
    out.push({ label: `Flag when ${sel.label} is ${firstOption}`, formula: `IF({${sel.key}} = ${quote(firstOption)}, "✓", "")` });
  }
  const d = dates[0];
  if (d) out.push({ label: `Days since ${d.label}`, formula: `DATEDIFF({${d.key}}, TODAY(), "days")` });
  const [t1, t2] = texts;
  if (out.length < 3 && t1 && t2) out.push({ label: `Join ${t1.label} and ${t2.label}`, formula: `CONCAT({${t1.key}}, " · ", {${t2.key}})` });
  else if (out.length < 3 && t1) out.push({ label: `${t1.label} in capitals`, formula: `UPPER({${t1.key}})` });
  return out.slice(0, 3);
}
