import { z, type ZodType } from "zod";
import { DATE_OPERATORS } from "../../filter/operators";
import type { AggregationId } from "../../query/types";
import type { FieldType, ParseResult } from "../types";
import { compareWithEmptyLast } from "../empty";
import { getZonedParts, zonedToInstant } from "../../time/zoned";
import { resolveConfig } from "./config";
import { isValidYmd, MONTH_NAMES } from "./calendar";

export interface DatetimeConfig {
  timeZone: string;
  displayFormat: "iso" | "dmy" | "mdy" | "long";
  hour12: boolean;
  inputOrder: "DMY" | "MDY";
}

const defaultConfig: DatetimeConfig = {
  timeZone: "Asia/Kolkata",
  displayFormat: "dmy",
  hour12: true,
  inputOrder: "DMY",
};

const configSchema: ZodType<DatetimeConfig> = z.object({
  timeZone: z.string(),
  displayFormat: z.enum(["iso", "dmy", "mdy", "long"]),
  hour12: z.boolean(),
  inputOrder: z.enum(["DMY", "MDY"]),
});

const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
/** Naive wall time: ISO `T` or the MySQL DATETIME space separator, optional seconds and fraction (1-9 digits, ms kept). */
const ISO_NO_OFFSET_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_MDY_TIME_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i;

function isValidIsoDateTimeString(s: string): boolean {
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

/** Parses a datetime string per the plan's accepted formats into an instant. Never throws. */
export function parseDatetimeString(input: string, inputOrder: "DMY" | "MDY", tz: string): Date | null {
  const s = input.trim();
  if (s.length === 0) return null;

  if (ISO_WITH_OFFSET_RE.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  }

  let m = ISO_NO_OFFSET_RE.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] ? Number(m[6]) : 0;
    const millisecond = m[7] ? Number(m[7].padEnd(3, "0").slice(0, 3)) : 0;
    if (!isValidYmd(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
    try {
      return zonedToInstant({ year, month, day, hour, minute, second, millisecond }, tz);
    } catch {
      return null;
    }
  }

  m = DATE_ONLY_RE.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!isValidYmd(year, month, day)) return null;
    try {
      return zonedToInstant({ year, month, day }, tz);
    } catch {
      return null;
    }
  }

  m = DMY_MDY_TIME_RE.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = Number(m[3]);
    const day = inputOrder === "DMY" ? a : b;
    const month = inputOrder === "DMY" ? b : a;
    if (!isValidYmd(year, month, day)) return null;
    let hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] ? Number(m[6]) : 0;
    const ampm = m[7]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59 || second > 59) return null;
    try {
      return zonedToInstant({ year, month, day, hour, minute, second }, tz);
    } catch {
      return null;
    }
  }

  return null;
}

function valueSchema(_config: DatetimeConfig): ZodType<string | null> {
  return z.union([z.string(), z.null()]).refine((v) => v === null || isValidIsoDateTimeString(v), {
    message: "Must be a valid ISO datetime",
  });
}

function parse(input: unknown, config: DatetimeConfig): ParseResult<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  const c = resolveConfig(defaultConfig, config);

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { ok: false, error: "Invalid date" };
    return { ok: true, value: input.toISOString() };
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, error: "Invalid date" };
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Invalid date" };
    return { ok: true, value: d.toISOString() };
  }
  if (typeof input !== "string") return { ok: false, error: "Invalid date" };

  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, value: null };

  const instant = parseDatetimeString(trimmed, c.inputOrder, c.timeZone);
  if (!instant) return { ok: false, error: `Cannot parse "${input}" as a date/time` };
  return { ok: true, value: instant.toISOString() };
}

function format(value: string | null | undefined, config: DatetimeConfig): string {
  if (!value) return "";
  const c = resolveConfig(defaultConfig, config);
  if (c.displayFormat === "iso") return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = getZonedParts(d, c.timeZone);
  const pad2 = (n: number): string => String(n).padStart(2, "0");

  let hour = p.hour;
  let suffix = "";
  if (c.hour12) {
    suffix = ` ${hour >= 12 ? "pm" : "am"}`;
    hour = hour % 12;
    if (hour === 0) hour = 12;
  }
  const hourStr = c.hour12 ? String(hour) : pad2(hour);
  const timeStr = `${hourStr}:${pad2(p.minute)}${suffix}`;

  let datePart: string;
  if (c.displayFormat === "dmy") datePart = `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
  else if (c.displayFormat === "mdy") datePart = `${pad2(p.month)}/${pad2(p.day)}/${p.year}`;
  else datePart = `${p.day} ${MONTH_NAMES[p.month - 1]} ${p.year}`;

  return c.displayFormat === "long" ? `${datePart}, ${timeStr}` : `${datePart} ${timeStr}`;
}

function serialize(value: string | null): unknown {
  return value;
}

function deserialize(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function compare(a: string | null, b: string | null, _config: DatetimeConfig): number {
  return compareWithEmptyLast(a, b, (x, y) => Date.parse(x as string) - Date.parse(y as string));
}

function defaultValue(_config: DatetimeConfig): string | null {
  return null;
}

function fillSeries(values: (string | null)[], count: number, _config: DatetimeConfig): string[] {
  const seeds = values
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => Date.parse(v))
    .filter((t) => !Number.isNaN(t));
  if (seeds.length === 0) return [];

  if (seeds.length === 1) {
    const out: string[] = [];
    let t = seeds[0] as number;
    for (let i = 0; i < count; i++) {
      t += 86_400_000;
      out.push(new Date(t).toISOString());
    }
    return out;
  }

  const last = seeds[seeds.length - 1] as number;
  const prev = seeds[seeds.length - 2] as number;
  const step = last - prev;
  const out: string[] = [];
  let t = last;
  for (let i = 0; i < count; i++) {
    t += step;
    out.push(new Date(t).toISOString());
  }
  return out;
}

const aggregations: readonly AggregationId[] = ["count", "min", "max", "countEmpty", "countFilled"];

export const datetimeFieldType: FieldType<string, DatetimeConfig> = {
  id: "datetime",
  label: "Date & time",
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
