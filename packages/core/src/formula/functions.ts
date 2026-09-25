import { addCalendarDays, getZonedParts, zonedToInstant } from "../time/zoned";
import {
  addCalendarMonths,
  calendarDayDiff,
  formatCalendarDay,
  type ParsedDateValue,
  parseDateValue,
  toInstant,
  toWallTime,
} from "./date-values";
import type { FormulaEnv, FormulaError, FormulaErrorCode, FormulaResultType, FormulaValue } from "./types";
import { isFormulaError } from "./types";

export interface FormulaFunctionDef {
  name: string;
  minArgs: number;
  /** Infinity for variadic functions. */
  maxArgs: number;
  inferReturn(argTypes: FormulaResultType[]): FormulaResultType | FormulaError;
  impl(args: FormulaValue[], env: FormulaEnv): FormulaValue | FormulaError;
}

type ParamType = FormulaResultType | "any";

function err(code: FormulaErrorCode, message: string): FormulaError {
  return { kind: "formulaError", code, message };
}

function typeErr(fn: string, index: number, expected: ParamType, got: FormulaResultType): FormulaError {
  return err("type", `${fn}: argument ${index + 1} must be ${expected}, got ${got}`);
}

/** Checks each argument type against `params` (then `rest` for extra args). */
function checkTypes(
  fn: string,
  argTypes: FormulaResultType[],
  params: ParamType[],
  rest?: ParamType,
): FormulaError | null {
  for (let i = 0; i < argTypes.length; i++) {
    const expected = i < params.length ? params[i] : rest;
    const got = argTypes[i];
    if (expected === undefined || got === undefined || expected === "any") continue;
    if (expected !== got) return typeErr(fn, i, expected, got);
  }
  return null;
}

/** Empty = null or a string that is blank after trimming. */
function isEmpty(v: FormulaValue | undefined): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function isBlank(v: FormulaValue | undefined): boolean {
  return v === undefined || v === null || v === "";
}

// ---- runtime argument coercion -------------------------------------------------------

function numberArg(fn: string, v: FormulaValue | undefined): number | null | FormulaError {
  if (isBlank(v)) return null;
  if (typeof v === "number") return v;
  return err("eval", `${fn}: expected a number, got ${JSON.stringify(v)}`);
}

function textArg(fn: string, v: FormulaValue | undefined): string | null | FormulaError {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  return err("eval", `${fn}: expected text, got ${JSON.stringify(v)}`);
}

function boolArg(fn: string, v: FormulaValue | undefined): boolean | FormulaError {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  return err("eval", `${fn}: expected a boolean, got ${JSON.stringify(v)}`);
}

function dateArg(fn: string, v: FormulaValue | undefined): ParsedDateValue | null | FormulaError {
  if (isBlank(v)) return null;
  if (typeof v === "string") {
    const parsed = parseDateValue(v);
    if (parsed) return parsed;
  }
  return err("eval", `${fn}: expected a date, got ${JSON.stringify(v)}`);
}

type DateUnit = "day" | "week" | "month" | "year" | "hour" | "minute";
const UNITS: ReadonlySet<string> = new Set<DateUnit>(["day", "week", "month", "year", "hour", "minute"]);

function unitArg(fn: string, v: FormulaValue | undefined): DateUnit | FormulaError {
  if (typeof v === "string") {
    const u = v.trim().toLowerCase();
    const singular = u.endsWith("s") ? u.slice(0, -1) : u;
    if (UNITS.has(singular)) return singular as DateUnit;
  }
  return err("eval", `${fn}: unknown unit ${JSON.stringify(v ?? null)}`);
}

/** Collects the non-empty number args, or the first coercion error. */
function numberList(fn: string, args: FormulaValue[]): number[] | FormulaError {
  const out: number[] = [];
  for (const a of args) {
    const n = numberArg(fn, a);
    if (isFormulaError(n)) return n;
    if (n !== null) out.push(n);
  }
  return out;
}

// ---- math helpers ---------------------------------------------------------------------

/** Multiplies by 10^digits via exponent notation, avoiding binary float error. */
function shift(x: number, digits: number): number {
  const [mantissa, exp = "0"] = String(x).split("e");
  return Number(`${mantissa}e${Number(exp) + digits}`);
}

function roundHalfAwayFromZero(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const result = sign * shift(Math.round(shift(Math.abs(x), digits)), -digits);
  return result === 0 ? 0 : result;
}

// ---- date helpers ---------------------------------------------------------------------

function dateAdd(d: ParsedDateValue, n: number, unit: DateUnit, tz: string): string {
  if (unit === "hour" || unit === "minute") {
    const ms = n * (unit === "hour" ? 3_600_000 : 60_000);
    return new Date(toInstant(d, tz).getTime() + ms).toISOString();
  }
  const day = d.kind === "date" ? d.day : toWallTime(d, tz);
  const next =
    unit === "day"
      ? addCalendarDays(day, n)
      : unit === "week"
        ? addCalendarDays(day, n * 7)
        : addCalendarMonths(day, unit === "month" ? n : n * 12);
  if (d.kind === "date") return formatCalendarDay(next);
  const wall = toWallTime(d, tz);
  return zonedToInstant({ ...wall, year: next.year, month: next.month, day: next.day }, tz).toISOString();
}

function wallKey(w: ReturnType<typeof toWallTime>): number[] {
  return [w.day, w.hour, w.minute, w.second, w.millisecond];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function monthDiff(a: ParsedDateValue, b: ParsedDateValue, tz: string): number {
  const wa = toWallTime(a, tz);
  const wb = toWallTime(b, tz);
  let months = wb.year * 12 + wb.month - (wa.year * 12 + wa.month);
  const cmp = compareKeys(wallKey(wb), wallKey(wa));
  if (months > 0 && cmp < 0) months--;
  else if (months < 0 && cmp > 0) months++;
  return months;
}

function truncate(x: number): number {
  const t = Math.trunc(x);
  return t === 0 ? 0 : t;
}

function dateDiff(a: ParsedDateValue, b: ParsedDateValue, unit: DateUnit, tz: string): number {
  switch (unit) {
    case "month":
      return monthDiff(a, b, tz);
    case "year":
      return truncate(monthDiff(a, b, tz) / 12);
    case "day":
    case "week": {
      const per = unit === "day" ? 1 : 7;
      if (a.kind === "date" && b.kind === "date") return truncate(calendarDayDiff(a.day, b.day) / per);
      const ms = toInstant(b, tz).getTime() - toInstant(a, tz).getTime();
      return truncate(ms / (86_400_000 * per));
    }
    case "hour":
    case "minute": {
      const ms = toInstant(b, tz).getTime() - toInstant(a, tz).getTime();
      return truncate(ms / (unit === "hour" ? 3_600_000 : 60_000));
    }
  }
}

function datePart(fn: string, part: "year" | "month" | "day") {
  return (args: FormulaValue[], env: FormulaEnv): FormulaValue | FormulaError => {
    const d = dateArg(fn, args[0]);
    if (d === null || isFormulaError(d)) return d;
    const day = d.kind === "date" ? d.day : getZonedParts(d.instant, env.tz);
    return day[part];
  };
}

// ---- definitions ----------------------------------------------------------------------

interface DefInput {
  minArgs: number;
  maxArgs: number;
  inferReturn(argTypes: FormulaResultType[]): FormulaResultType | FormulaError;
  impl(args: FormulaValue[], env: FormulaEnv): FormulaValue | FormulaError;
}

/** Simple fixed signature: checks params/rest, then returns `ret`. */
function sig(fn: string, params: ParamType[], ret: FormulaResultType, rest?: ParamType) {
  return (argTypes: FormulaResultType[]): FormulaResultType | FormulaError =>
    checkTypes(fn, argTypes, params, rest) ?? ret;
}

function aggregate(fn: string, reduce: (xs: number[]) => number | null): DefInput {
  return {
    minArgs: 0,
    maxArgs: Number.POSITIVE_INFINITY,
    inferReturn: sig(fn, [], "number", "number"),
    impl: (args) => {
      const xs = numberList(fn, args);
      return isFormulaError(xs) ? xs : reduce(xs);
    },
  };
}

function textMap(fn: string, f: (s: string) => string): DefInput {
  return {
    minArgs: 1,
    maxArgs: 1,
    inferReturn: sig(fn, ["text"], "text"),
    impl: (args) => {
      const s = textArg(fn, args[0]);
      return s === null || isFormulaError(s) ? s : f(s);
    },
  };
}

function slice(fn: string, fromLeft: boolean): DefInput {
  return {
    minArgs: 2,
    maxArgs: 2,
    inferReturn: sig(fn, ["text", "number"], "text"),
    impl: (args) => {
      const s = textArg(fn, args[0]);
      if (s === null || isFormulaError(s)) return s;
      const n = numberArg(fn, args[1]);
      if (isFormulaError(n)) return n;
      const count = Math.floor(n ?? 0);
      if (count < 0 || Number.isNaN(count)) return err("eval", `${fn}: length must not be negative`);
      const chars = Array.from(s);
      return (fromLeft ? chars.slice(0, count) : chars.slice(Math.max(0, chars.length - count))).join("");
    },
  };
}

function logical(fn: string, isAnd: boolean): DefInput {
  return {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    inferReturn: sig(fn, [], "boolean", "boolean"),
    impl: (args) => {
      let acc = isAnd;
      for (const a of args) {
        const b = boolArg(fn, a);
        if (isFormulaError(b)) return b;
        acc = isAnd ? acc && b : acc || b;
      }
      return acc;
    },
  };
}

const DEFS: Record<string, DefInput> = {
  IF: {
    minArgs: 2,
    maxArgs: 3,
    inferReturn: (argTypes) => {
      const [cond, thenType, elseType] = argTypes;
      if (cond !== undefined && cond !== "boolean") return typeErr("IF", 0, "boolean", cond);
      if (thenType !== undefined && elseType !== undefined && thenType !== elseType) {
        return err("type", `IF: branch types must match, got ${thenType} and ${elseType}`);
      }
      return thenType ?? elseType ?? err("type", "IF: missing branch");
    },
    impl: (args) => {
      const c = boolArg("IF", args[0]);
      if (isFormulaError(c)) return c;
      return (c ? args[1] : args[2]) ?? null;
    },
  },
  AND: logical("AND", true),
  OR: logical("OR", false),
  NOT: {
    minArgs: 1,
    maxArgs: 1,
    inferReturn: sig("NOT", ["boolean"], "boolean"),
    impl: (args) => {
      const b = boolArg("NOT", args[0]);
      return isFormulaError(b) ? b : !b;
    },
  },
  SUM: aggregate("SUM", (xs) => xs.reduce((s, x) => s + x, 0)),
  AVG: aggregate("AVG", (xs) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length)),
  MIN: aggregate("MIN", (xs) => (xs.length === 0 ? null : Math.min(...xs))),
  MAX: aggregate("MAX", (xs) => (xs.length === 0 ? null : Math.max(...xs))),
  ROUND: {
    minArgs: 1,
    maxArgs: 2,
    inferReturn: sig("ROUND", ["number", "number"], "number"),
    impl: (args) => {
      const x = numberArg("ROUND", args[0]);
      if (x === null || isFormulaError(x)) return x;
      const d = numberArg("ROUND", args[1]);
      if (isFormulaError(d)) return d;
      return roundHalfAwayFromZero(x, Math.trunc(d ?? 0));
    },
  },
  ABS: {
    minArgs: 1,
    maxArgs: 1,
    inferReturn: sig("ABS", ["number"], "number"),
    impl: (args) => {
      const x = numberArg("ABS", args[0]);
      return x === null || isFormulaError(x) ? x : Math.abs(x);
    },
  },
  CONCAT: {
    minArgs: 0,
    maxArgs: Number.POSITIVE_INFINITY,
    inferReturn: sig("CONCAT", [], "text", "any"),
    impl: (args) => args.map((a) => (a === null || a === undefined ? "" : String(a))).join(""),
  },
  UPPER: textMap("UPPER", (s) => s.toUpperCase()),
  LOWER: textMap("LOWER", (s) => s.toLowerCase()),
  TRIM: textMap("TRIM", (s) => s.trim()),
  LEN: {
    minArgs: 1,
    maxArgs: 1,
    inferReturn: sig("LEN", ["text"], "number"),
    impl: (args) => {
      const s = textArg("LEN", args[0]);
      if (isFormulaError(s)) return s;
      return s === null ? 0 : Array.from(s).length;
    },
  },
  LEFT: slice("LEFT", true),
  RIGHT: slice("RIGHT", false),
  TODAY: {
    minArgs: 0,
    maxArgs: 0,
    inferReturn: sig("TODAY", [], "date"),
    impl: (_args, env) => formatCalendarDay(getZonedParts(env.now, env.tz)),
  },
  NOW: {
    minArgs: 0,
    maxArgs: 0,
    inferReturn: sig("NOW", [], "date"),
    impl: (_args, env) => env.now.toISOString(),
  },
  DATEADD: {
    minArgs: 3,
    maxArgs: 3,
    inferReturn: sig("DATEADD", ["date", "number", "text"], "date"),
    impl: (args, env) => {
      const unit = unitArg("DATEADD", args[2]);
      if (isFormulaError(unit)) return unit;
      const d = dateArg("DATEADD", args[0]);
      if (d === null || isFormulaError(d)) return d;
      const n = numberArg("DATEADD", args[1]);
      if (isFormulaError(n)) return n;
      return dateAdd(d, Math.trunc(n ?? 0), unit, env.tz);
    },
  },
  DATEDIFF: {
    minArgs: 3,
    maxArgs: 3,
    inferReturn: sig("DATEDIFF", ["date", "date", "text"], "number"),
    impl: (args, env) => {
      const unit = unitArg("DATEDIFF", args[2]);
      if (isFormulaError(unit)) return unit;
      const a = dateArg("DATEDIFF", args[0]);
      if (a === null || isFormulaError(a)) return a;
      const b = dateArg("DATEDIFF", args[1]);
      if (b === null || isFormulaError(b)) return b;
      return dateDiff(a, b, unit, env.tz);
    },
  },
  YEAR: { minArgs: 1, maxArgs: 1, inferReturn: sig("YEAR", ["date"], "number"), impl: datePart("YEAR", "year") },
  MONTH: { minArgs: 1, maxArgs: 1, inferReturn: sig("MONTH", ["date"], "number"), impl: datePart("MONTH", "month") },
  DAY: { minArgs: 1, maxArgs: 1, inferReturn: sig("DAY", ["date"], "number"), impl: datePart("DAY", "day") },
  IS_EMPTY: {
    minArgs: 1,
    maxArgs: 1,
    inferReturn: sig("IS_EMPTY", ["any"], "boolean"),
    impl: (args) => isEmpty(args[0]),
  },
  COALESCE: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    inferReturn: (argTypes) => {
      const first = argTypes[0];
      if (first === undefined) return err("type", "COALESCE: needs at least one argument");
      return checkTypes("COALESCE", argTypes, [], first) ?? first;
    },
    impl: (args) => args.find((a) => !isEmpty(a)) ?? null,
  },
};

function build(name: string, input: DefInput): FormulaFunctionDef {
  return {
    name,
    minArgs: input.minArgs,
    maxArgs: input.maxArgs,
    inferReturn: input.inferReturn,
    impl: (args, env) => {
      try {
        return input.impl(args, env);
      } catch (e) {
        // e.g. RangeError for an unknown env.tz
        return err("eval", `${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

/** The v1 function library (spec 4.8), keyed by upper-case name. */
export const FORMULA_FUNCTIONS: ReadonlyMap<string, FormulaFunctionDef> = new Map(
  Object.entries(DEFS).map(([name, input]) => [name, build(name, input)]),
);

/** Case-insensitive lookup. */
export function getFormulaFunction(name: string): FormulaFunctionDef | undefined {
  return FORMULA_FUNCTIONS.get(name.toUpperCase());
}
