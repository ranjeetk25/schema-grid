/**
 * Test field-type registry.
 *
 * TODO(core): core's `createDefaultRegistry()` is not available yet. This file
 * builds MINIMAL fake field types that follow the core plan's contract
 * (ParseResult shape, value shapes, format rules). When core ships, replace the
 * body of `makeRegistry()` with `return createDefaultRegistry();` and delete the
 * FAKES section below.
 */
import type {
  AnyFieldType,
  FieldType,
  FieldTypeRegistry,
  Option,
  ParseResult,
} from "../../src/internal/core";

// ===========================================================================
// PUBLIC
// ===========================================================================

export function makeRegistry(): FieldTypeRegistry {
  // TODO(core): return createDefaultRegistry();
  const registry = createFakeRegistry();
  for (const t of FAKE_TYPES) registry.register(t);
  return registry;
}

// ===========================================================================
// FAKES — delete this whole section when core's registry is available
// ===========================================================================

function createFakeRegistry(): FieldTypeRegistry {
  const map = new Map<string, AnyFieldType>();
  return {
    register(type) {
      if (map.has(type.id)) throw new Error(`Duplicate field type ${type.id}`);
      map.set(type.id, type);
    },
    get: (id) => map.get(id),
    list: () => [...map.values()],
    has: (id) => map.has(id),
  };
}

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = (error: string): ParseResult<never> => ({ ok: false, error });

function asText(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return input.trim();
  if (typeof input === "number" || typeof input === "boolean")
    return String(input);
  return null;
}

function cmp<T>(a: T | null, b: T | null, f: (x: T, y: T) => number): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  return f(a, b);
}

function base<TValue, TConfig>(
  id: string,
  defaultConfig: TConfig,
  parts: Pick<FieldType<TValue, TConfig>, "parse" | "format"> &
    Partial<FieldType<TValue, TConfig>>,
): FieldType<TValue, TConfig> {
  return {
    id,
    label: id,
    defaultConfig,
    serialize: (v) => v,
    deserialize: (raw) => (raw as TValue) ?? null,
    compare: (a, b) => cmp(a, b, (x, y) => String(x).localeCompare(String(y))),
    defaultValue: () => null,
    ...parts,
  };
}

// --- text-like -------------------------------------------------------------

const textType = base<string, { maxLength?: number }>(
  "text",
  {},
  {
    parse(input, config) {
      const s = asText(input);
      if (s === null) return input == null ? ok(null) : fail("Not text");
      if (s === "") return ok(null);
      const one = s.replace(/\s*[\r\n]+\s*/g, " ");
      if (config?.maxLength !== undefined && one.length > config.maxLength)
        return fail(`Longer than ${config.maxLength} characters`);
      return ok(one);
    },
    format: (v) => (v == null ? "" : String(v)),
  },
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailType = base<string, Record<string, never>>(
  "email",
  {},
  {
    parse(input) {
      const s = asText(input);
      if (!s) return ok(null);
      if (!EMAIL_RE.test(s)) return fail("Invalid email address");
      const at = s.lastIndexOf("@");
      return ok(`${s.slice(0, at)}@${s.slice(at + 1).toLowerCase()}`);
    },
    format: (v) => (v == null ? "" : String(v)),
  },
);

const urlType = base<string, Record<string, never>>(
  "url",
  {},
  {
    parse(input) {
      const s = asText(input);
      if (!s) return ok(null);
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
      try {
        const u = new URL(withScheme);
        if (!u.hostname.includes(".") || /\s/.test(s))
          return fail("Invalid URL");
        return ok(withScheme);
      } catch {
        return fail("Invalid URL");
      }
    },
    format: (v) => (v == null ? "" : String(v)),
  },
);

// --- numeric ---------------------------------------------------------------

function parseNumericText(s: string): number | null {
  let t = s.trim().replace(/^([-+]?)\s*[₹$€£]\s*/, "$1").replace(/[\s,]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function parseNumber(input: unknown): ParseResult<number | null> {
  if (typeof input === "number")
    return Number.isFinite(input) ? ok(input) : fail("Not a number");
  const s = asText(input);
  if (!s) return ok(null);
  const n = parseNumericText(s);
  return n === null ? fail("Not a number") : ok(n);
}

interface NumberConfig {
  precision?: number;
  useGrouping?: boolean;
  locale?: string;
}
const numberType = base<number, NumberConfig>(
  "number",
  { precision: 0, useGrouping: true, locale: "en-IN" },
  {
    parse: (input) => parseNumber(input),
    format(v, config) {
      if (v == null) return "";
      const p = config?.precision;
      return new Intl.NumberFormat(config?.locale ?? "en-IN", {
        useGrouping: config?.useGrouping ?? true,
        ...(p === undefined
          ? { maximumFractionDigits: 10 }
          : { minimumFractionDigits: p, maximumFractionDigits: p }),
      }).format(v);
    },
    compare: (a, b) => cmp(a, b, (x, y) => x - y),
  },
);

interface CurrencyConfig {
  currencyCode?: string;
  locale?: string;
  precision?: number;
}
const currencyType = base<number, CurrencyConfig>(
  "currency",
  { currencyCode: "INR", locale: "en-IN", precision: 2 },
  {
    parse: (input) => parseNumber(input),
    format(v, config) {
      if (v == null) return "";
      const p = config?.precision ?? 2;
      return new Intl.NumberFormat(config?.locale ?? "en-IN", {
        style: "currency",
        currency: config?.currencyCode ?? "INR",
        minimumFractionDigits: p,
        maximumFractionDigits: p,
      }).format(v);
    },
    compare: (a, b) => cmp(a, b, (x, y) => x - y),
  },
);

// --- boolean ---------------------------------------------------------------

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "checked", "✓"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "unchecked"]);
const booleanType = base<boolean, Record<string, never>>(
  "boolean",
  {},
  {
    parse(input) {
      if (typeof input === "boolean") return ok(input);
      const s = asText(input)?.toLowerCase();
      if (s && TRUE_WORDS.has(s)) return ok(true);
      if (s && FALSE_WORDS.has(s)) return ok(false);
      return fail("Not a boolean");
    },
    format: (v) => (v == null ? "" : v ? "true" : "false"),
    defaultValue: () => false,
    compare: (a, b) => cmp(a, b, (x, y) => Number(x) - Number(y)),
  },
);

// --- dates -----------------------------------------------------------------

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

interface DateConfig {
  displayFormat?: "iso" | "dmy" | "mdy" | "long";
  inputOrder?: "DMY" | "MDY";
}

function parseYmd(s: string, order: "DMY" | "MDY"): string | null {
  let y: number;
  let m: number;
  let d: number;
  let mt = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s);
  if (mt) {
    y = +mt[1]!;
    m = +mt[2]!;
    d = +mt[3]!;
  } else if ((mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    const a = +mt[1]!;
    const b = +mt[2]!;
    y = +mt[3]!;
    [d, m] = order === "DMY" ? [a, b] : [b, a];
  } else if ((mt = /^(\d{1,2})-([a-z]{3})-(\d{4})$/i.exec(s))) {
    d = +mt[1]!;
    m = MONTHS.indexOf(mt[2]!.toLowerCase()) + 1;
    y = +mt[3]!;
  } else return null;
  return isValidYmd(y, m, d) ? `${pad(y, 4)}-${pad(m)}-${pad(d)}` : null;
}

const dateType = base<string, DateConfig>(
  "date",
  { displayFormat: "dmy", inputOrder: "DMY" },
  {
    parse(input, config) {
      const s = asText(input);
      if (!s) return ok(null);
      const v = parseYmd(s, config?.inputOrder ?? "DMY");
      return v ? ok(v) : fail("Invalid date");
    },
    format(v, config) {
      if (v == null) return "";
      const [y, m, d] = String(v).split("-");
      switch (config?.displayFormat ?? "dmy") {
        case "iso":
          return String(v);
        case "mdy":
          return `${m}/${d}/${y}`;
        case "long":
          return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
        default:
          return `${d}/${m}/${y}`;
      }
    },
  },
);

interface DateTimeConfig {
  timeZone?: string;
  displayFormat?: "iso" | "dmy" | "mdy" | "long";
  hour12?: boolean;
  inputOrder?: "DMY" | "MDY";
}

/** Wall-clock fields in `tz` → UTC instant (two-pass offset fix-up). */
function wallToInstant(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return (
      Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) -
      Math.floor(t / 1000) * 1000
    );
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

const datetimeType = base<string, DateTimeConfig>(
  "datetime",
  { timeZone: "Asia/Kolkata", displayFormat: "dmy", hour12: true, inputOrder: "DMY" },
  {
    parse(input, config) {
      if (input instanceof Date)
        return Number.isNaN(input.getTime()) ? fail("Invalid date/time") : ok(input.toISOString());
      const s = asText(input);
      if (!s) return ok(null);
      if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s) && /\d{4}-\d{2}-\d{2}T/.test(s)) {
        const t = Date.parse(s);
        return Number.isNaN(t) ? fail("Invalid date/time") : ok(new Date(t).toISOString());
      }
      const mt =
        /^(.+?)[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s) ??
        /^(.+)$/.exec(s);
      const ymd = mt ? parseYmd(mt[1]!, config?.inputOrder ?? "DMY") : null;
      if (!mt || !ymd) return fail("Invalid date/time");
      const [y, mo, d] = ymd.split("-").map(Number) as [number, number, number];
      const h = mt[2] ? Number(mt[2]) : 0;
      const mi = mt[3] ? Number(mt[3]) : 0;
      const sec = mt[4] ? Number(mt[4]) : 0;
      if (h > 23 || mi > 59 || sec > 59) return fail("Invalid date/time");
      return ok(
        wallToInstant(y, mo, d, h, mi, sec, config?.timeZone ?? "Asia/Kolkata").toISOString(),
      );
    },
    format(v, config) {
      if (v == null) return "";
      if ((config?.displayFormat ?? "dmy") === "iso") return String(v);
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: config?.timeZone ?? "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(String(v)));
      const g = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
      return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
    },
  },
);

// --- options ---------------------------------------------------------------

interface OptionsConfig {
  options: Option[];
  allowCreate?: boolean;
}

function findOption(options: Option[], raw: string): Option | undefined {
  const needle = raw.trim().toLowerCase();
  return (
    options.find((o) => o.id === raw.trim()) ??
    options.find((o) => o.label.trim().toLowerCase() === needle)
  );
}

function makeSelect(id: "select" | "creatableSelect") {
  return base<string, OptionsConfig>(
    id,
    { options: [] },
    {
      parse(input, config) {
        const s = asText(input);
        if (!s) return ok(null);
        const opt = findOption(config?.options ?? [], s);
        if (opt) return ok(opt.id);
        if (id === "creatableSelect")
          return { ok: true, value: s, pendingOptions: [s] };
        return fail(`Unknown option "${s}"`);
      },
      format(v, config) {
        if (v == null) return "";
        return config?.options?.find((o) => o.id === v)?.label ?? String(v);
      },
    },
  );
}

const multiSelectType = base<string[], OptionsConfig>(
  "multiSelect",
  { options: [] },
  {
    parse(input, config) {
      let pieces: string[];
      if (Array.isArray(input)) pieces = input.map(String);
      else {
        const s = asText(input);
        if (!s) return ok([]);
        if (s.startsWith("[")) {
          try {
            pieces = (JSON.parse(s) as unknown[]).map(String);
          } catch {
            return fail("Invalid list");
          }
        } else pieces = s.split(/[,;]/);
      }
      const options = config?.options ?? [];
      const ids: string[] = [];
      const pending: string[] = [];
      const unknown: string[] = [];
      for (const p of pieces.map((x) => x.trim()).filter(Boolean)) {
        const opt = findOption(options, p);
        if (opt) {
          if (!ids.includes(opt.id)) ids.push(opt.id);
        } else if (config?.allowCreate) {
          if (!pending.includes(p)) pending.push(p);
        } else unknown.push(p);
      }
      if (unknown.length > 0)
        return fail(`Unknown option(s): ${unknown.map((u) => `"${u}"`).join(", ")}`);
      const order = (x: string) => options.findIndex((o) => o.id === x);
      ids.sort((a, b) => order(a) - order(b));
      return pending.length > 0
        ? { ok: true, value: [...ids, ...pending], pendingOptions: pending }
        : ok(ids);
    },
    format(v, config) {
      if (!Array.isArray(v)) return "";
      return v
        .map((x) => config?.options?.find((o) => o.id === x)?.label ?? String(x))
        .join(", ");
    },
    defaultValue: () => [],
  },
);

// --- references ------------------------------------------------------------

interface UserRef {
  id: string;
  name?: string;
}
const userType = base<UserRef, Record<string, never>>(
  "user",
  {},
  {
    parse(input) {
      if (input && typeof input === "object" && "id" in input)
        return ok(input as UserRef);
      const s = asText(input);
      if (!s) return ok(null);
      return ok({ id: s });
    },
    format: (v) => (v == null ? "" : (v.name ?? v.id)),
    compare: (a, b) =>
      cmp(a, b, (x, y) => (x.name ?? x.id).localeCompare(y.name ?? y.id)),
  },
);

// --- formula ---------------------------------------------------------------

interface FormulaConfig {
  resultType?: "number" | "text" | "boolean" | "date";
  precision?: number;
}
const formulaType = base<unknown, FormulaConfig>(
  "formula",
  { resultType: "number" },
  {
    parse: () => fail("Formula columns are read-only"),
    format(v) {
      if (v == null) return "";
      if (typeof v === "boolean") return v ? "true" : "false";
      return String(v);
    },
  },
);

const FAKE_TYPES: AnyFieldType[] = [
  textType,
  emailType,
  numberType,
  currencyType,
  booleanType,
  dateType,
  datetimeType,
  makeSelect("select"),
  multiSelectType,
  makeSelect("creatableSelect"),
  userType,
  urlType,
  formulaType,
];
