import { FORMULA_FUNCTIONS } from "../internal/core-contracts";

export interface FormulaFunctionDoc {
  name: string;
  signature: string;
  description: string;
}

/** Human docs for the core function library; unknown (future) functions fall back to their arity. */
const DOCS: Record<string, [signature: string, description: string]> = {
  IF: ["IF(condition, then, else?)", "Returns one value when true, another when false"],
  AND: ["AND(a, b, …)", "True when every argument is true"],
  OR: ["OR(a, b, …)", "True when any argument is true"],
  NOT: ["NOT(value)", "Flips true and false"],
  SUM: ["SUM(a, b, …)", "Adds numbers; blanks count as 0"],
  AVG: ["AVG(a, b, …)", "Average of the non-blank numbers"],
  MIN: ["MIN(a, b, …)", "Smallest number"],
  MAX: ["MAX(a, b, …)", "Largest number"],
  ROUND: ["ROUND(number, digits?)", "Rounds to a number of decimals"],
  ABS: ["ABS(number)", "Absolute value"],
  CONCAT: ["CONCAT(a, b, …)", "Joins text together"],
  UPPER: ["UPPER(text)", "Converts to UPPER CASE"],
  LOWER: ["LOWER(text)", "Converts to lower case"],
  TRIM: ["TRIM(text)", "Removes leading and trailing spaces"],
  LEN: ["LEN(text)", "Number of characters"],
  LEFT: ["LEFT(text, count)", "First characters of the text"],
  RIGHT: ["RIGHT(text, count)", "Last characters of the text"],
  TODAY: ["TODAY()", "Today's date"],
  NOW: ["NOW()", "The current date and time"],
  DATEADD: ['DATEADD(date, amount, "days")', "Adds days, weeks, months or years to a date"],
  DATEDIFF: ['DATEDIFF(start, end, "days")', "Time between two dates in a unit"],
  YEAR: ["YEAR(date)", "The year of a date"],
  MONTH: ["MONTH(date)", "The month of a date (1–12)"],
  DAY: ["DAY(date)", "The day of the month"],
  IS_EMPTY: ["IS_EMPTY(value)", "True when the value is blank"],
  COALESCE: ["COALESCE(a, b, …)", "The first value that is not blank"],
};

const arity = (name: string, min: number, max: number) => {
  const args = Array.from({ length: Math.min(min, 3) }, (_, i) => `arg${i + 1}`);
  if (max > min) args.push("…");
  return `${name}(${args.join(", ")})`;
};

export function formulaFunctionDocs(): FormulaFunctionDoc[] {
  return [...FORMULA_FUNCTIONS.values()].map((fn) => {
    const doc = DOCS[fn.name];
    return {
      name: fn.name,
      signature: doc?.[0] ?? arity(fn.name, fn.minArgs, fn.maxArgs),
      description: doc?.[1] ?? "",
    };
  });
}
