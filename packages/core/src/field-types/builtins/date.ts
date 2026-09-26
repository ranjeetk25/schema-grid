import { z, type ZodType } from "zod";
import { DATE_OPERATORS } from "../../filter/operators";
import type { AggregationId } from "../../query/types";
import type { FieldType, ParseResult } from "../types";
import { compareWithEmptyLast } from "../empty";
import { DEFAULT_TIME_ZONE, getZonedParts } from "../../time/zoned";
import { resolveConfig } from "./config";
import {
  addMonthsClamped,
  dayNumberToYmd,
  formatYmd,
  isValidYmd,
  MONTH_NAMES,
  ymdToDayNumber,
  type Ymd,
} from "./calendar";

export interface DateConfig {
  displayFormat: "iso" | "dmy" | "mdy" | "long";
  inputOrder: "DMY" | "MDY";
  /**
   * Zone whose calendar day a JS `Date` INPUT to `parse` is read in (a
   * `Date` is an instant; a date cell is a calendar day). Strings are
   * zone-free and never use it. Default `Asia/Kolkata` (`DEFAULT_TIME_ZONE`).
   * Not part of the editable column config (`configSchema`).
   */
  timeZone?: string;
}

const defaultConfig: DateConfig = {
  displayFormat: "dmy",
  inputOrder: "DMY",
};

const configSchema: ZodType<DateConfig> = z.object({
  displayFormat: z.enum(["iso", "dmy", "mdy", "long"]),
  inputOrder: z.enum(["DMY", "MDY"]),
});

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoYmdString(s: string): boolean {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return false;
  return isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

function monthNumberFromName(name: string): number | null {
  const lower = name.toLowerCase().slice(0, 3);
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === lower);
  return idx === -1 ? null : idx + 1;
}

/** Parses a date string per the plan's accepted formats. Returns `null` when unparseable. */
export function parseDateString(input: string, inputOrder: "DMY" | "MDY"): Ymd | null {
  const trimmed = input.trim();
  const tIdx = trimmed.indexOf("T");
  const datePart = tIdx > 0 ? trimmed.slice(0, tIdx) : trimmed;

  let m = ISO_DATE_RE.exec(datePart);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    return isValidYmd(year, month, day) ? { year, month, day } : null;
  }

  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(datePart);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = Number(m[3]);
    const day = inputOrder === "DMY" ? a : b;
    const month = inputOrder === "DMY" ? b : a;
    return isValidYmd(year, month, day) ? { year, month, day } : null;
  }

  // "25-Sep-2026" / "25 Sep 2026"
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(datePart);
  if (m) {
    const day = Number(m[1]);
    const month = monthNumberFromName(m[2] ?? "");
    const year = Number(m[3]);
    if (month === null) return null;
    return isValidYmd(year, month, day) ? { year, month, day } : null;
  }

  // "Sep 25, 2026"
  m = /^([A-Za-z]{3,9})[\s]+(\d{1,2}),?\s+(\d{4})$/.exec(datePart);
  if (m) {
    const month = monthNumberFromName(m[1] ?? "");
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (month === null) return null;
    return isValidYmd(year, month, day) ? { year, month, day } : null;
  }

  return null;
}

function valueSchema(_config: DateConfig): ZodType<string | null> {
  return z.union([z.string(), z.null()]).refine((v) => v === null || isIsoYmdString(v), {
    message: "Must be a valid YYYY-MM-DD date",
  });
}

function parse(input: unknown, config: DateConfig): ParseResult<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  const c = resolveConfig(defaultConfig, config);

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { ok: false, error: "Invalid date" };
    // The LOCAL calendar day in the configured zone, never `toISOString()`: a driver
    // that builds `Date`s in a zone east of UTC would otherwise lose a day.
    let p: { year: number; month: number; day: number };
    try {
      p = getZonedParts(input, c.timeZone ?? DEFAULT_TIME_ZONE);
    } catch {
      return { ok: false, error: `Unknown time zone "${c.timeZone}"` };
    }
    return { ok: true, value: formatYmd(p.year, p.month, p.day, "iso") };
  }
  if (typeof input !== "string") return { ok: false, error: "Invalid date" };

  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, value: null };

  const ymd = parseDateString(trimmed, c.inputOrder);
  if (!ymd) return { ok: false, error: `Cannot parse "${input}" as a date` };
  return { ok: true, value: formatYmd(ymd.year, ymd.month, ymd.day, "iso") };
}

function format(value: string | null | undefined, config: DateConfig): string {
  if (!value) return "";
  const m = ISO_DATE_RE.exec(value);
  if (!m) return "";
  const c = resolveConfig(defaultConfig, config);
  return formatYmd(Number(m[1]), Number(m[2]), Number(m[3]), c.displayFormat);
}

function serialize(value: string | null): unknown {
  return value;
}

function deserialize(raw: unknown): string | null {
  return typeof raw === "string" && isIsoYmdString(raw) ? raw : null;
}

function compare(a: string | null, b: string | null, _config: DateConfig): number {
  return compareWithEmptyLast(a, b, (x, y) => ((x as string) < (y as string) ? -1 : (x as string) > (y as string) ? 1 : 0));
}

function defaultValue(_config: DateConfig): string | null {
  return null;
}

function toYmd(value: string): Ymd {
  const m = ISO_DATE_RE.exec(value) as RegExpExecArray;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function fillSeries(values: (string | null)[], count: number, _config: DateConfig): string[] {
  const seeds = values
    .filter((v): v is string => typeof v === "string" && isIsoYmdString(v))
    .map(toYmd);
  if (seeds.length === 0) return [];

  if (seeds.length === 1) {
    const first = seeds[0] as Ymd;
    const startDayNumber = ymdToDayNumber(first.year, first.month, first.day);
    const out: string[] = [];
    for (let i = 1; i <= count; i++) {
      const ymd = dayNumberToYmd(startDayNumber + i);
      out.push(formatYmd(ymd.year, ymd.month, ymd.day, "iso"));
    }
    return out;
  }

  const last = seeds[seeds.length - 1] as Ymd;
  const prev = seeds[seeds.length - 2] as Ymd;
  const monthDiff = last.year * 12 + (last.month - 1) - (prev.year * 12 + (prev.month - 1));

  if (monthDiff !== 0) {
    const check = addMonthsClamped(prev.year, prev.month, prev.day, monthDiff);
    if (check.year === last.year && check.month === last.month && check.day === last.day) {
      const out: string[] = [];
      let totalMonths = monthDiff;
      for (let i = 0; i < count; i++) {
        totalMonths += monthDiff;
        const ymd = addMonthsClamped(prev.year, prev.month, prev.day, totalMonths);
        out.push(formatYmd(ymd.year, ymd.month, ymd.day, "iso"));
      }
      return out;
    }
  }

  const step =
    ymdToDayNumber(last.year, last.month, last.day) - ymdToDayNumber(prev.year, prev.month, prev.day);
  let dayNumber = ymdToDayNumber(last.year, last.month, last.day);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    dayNumber += step;
    const ymd = dayNumberToYmd(dayNumber);
    out.push(formatYmd(ymd.year, ymd.month, ymd.day, "iso"));
  }
  return out;
}

const aggregations: readonly AggregationId[] = ["count", "min", "max", "countEmpty", "countFilled"];

export const dateFieldType: FieldType<string, DateConfig> = {
  id: "date",
  label: "Date",
  configSchema,
  defaultConfig,
  valueSchema,
  parse,
  format,
  serialize,
  deserialize,
  compare,
  operators: DATE_OPERATORS,
  fillSeries,
  aggregations,
  defaultValue,
};
