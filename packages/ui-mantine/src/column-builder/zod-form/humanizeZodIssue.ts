/**
 * Friendly copy for Zod issues (v3 and v4 shapes). Raw Zod text such as
 * "String must contain at least 1 character(s)" never reaches the UI: every
 * issue is mapped per code to a sentence naming the field.
 */

/** The parts of a Zod v3 / v4 issue we read. */
export interface ZodIssueLike {
  code: string;
  path: readonly PropertyKey[];
  message?: string;
  /** v3 size kind / v4 `origin`. */
  type?: unknown;
  origin?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  inclusive?: unknown;
  exact?: unknown;
  expected?: unknown;
  /** v3 invalid_type. */
  received?: unknown;
  /** v4 invalid_type carries the input (when reportInput) — undefined means missing. */
  input?: unknown;
  /** v3 invalid_enum_value. */
  options?: unknown;
  /** v4 invalid_value. */
  values?: unknown;
  /** v3 invalid_string. */
  validation?: unknown;
  /** v4 invalid_format. */
  format?: unknown;
  multipleOf?: unknown;
  divisor?: unknown;
}

/** Names for the keys inside an option list row (`options.0.label`). */
const OPTION_ROW_FIELDS: Record<string, string> = {
  label: "Option name",
  value: "Option value",
  id: "Option id",
  color: "Colour",
};

/** "maxLength" / "max_length" → "Max length". */
function words(key: string): string {
  const w = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** The human name of the field an issue points at. */
export function fieldNameForPath(path: readonly PropertyKey[]): string {
  const last = path[path.length - 1];
  const inRow = path.some((p) => typeof p === "number");
  if (typeof last === "string") {
    if (inRow && OPTION_ROW_FIELDS[last]) return OPTION_ROW_FIELDS[last];
    return words(last);
  }
  if (typeof last === "number") {
    const parent = path[path.length - 2];
    return typeof parent === "string" && parent === "options" ? "Option" : "This item";
  }
  return "This setting";
}

const num = (n: unknown): number => (typeof n === "number" || typeof n === "bigint" ? Number(n) : 0);

function listOf(values: readonly unknown[]): string {
  const shown = values.slice(0, 5).map((v) => String(v));
  return values.length > 5 ? `${shown.join(", ")}, …` : shown.join(", ");
}

/** "Options" → "option", "Tags" → "tag" (for "Add at least one …"). */
function singular(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith("s") ? lower.slice(0, -1) : lower;
}

function formatMessage(name: string, format: unknown): string {
  switch (format) {
    case "email":
      return "Enter a valid email address";
    case "url":
      return "Enter a valid URL, e.g. https://example.com";
    case "uuid":
    case "cuid":
    case "cuid2":
    case "ulid":
      return `${name} is not a valid id`;
    case "datetime":
    case "date":
    case "time":
      return `${name} is not a valid date`;
    case "regex":
      return `${name} contains characters that aren't allowed`;
    default:
      return `${name} isn't in the right format`;
  }
}

/** One friendly sentence for a Zod issue. `fieldName` overrides the name derived from the path. */
export function humanizeZodIssue(issue: ZodIssueLike, opts: { fieldName?: string } = {}): string {
  const name = opts.fieldName ?? fieldNameForPath(issue.path);
  const kind = issue.type ?? issue.origin;
  switch (issue.code) {
    case "too_small": {
      const min = num(issue.minimum);
      if (kind === "string") {
        if (min <= 1) return `${name} is required`;
        return issue.exact ? `${name} must be exactly ${min} characters` : `${name} needs at least ${min} characters`;
      }
      if (kind === "array" || kind === "set") {
        return min <= 1 ? `Add at least one ${singular(name)}` : `Add at least ${min} ${name.toLowerCase()}`;
      }
      if (kind === "date") return `${name} is too early`;
      if (kind === "number" || kind === "bigint" || kind === "int") {
        return issue.inclusive === false ? `${name} must be more than ${min}` : `${name} must be ${min} or more`;
      }
      return `${name} is too small`;
    }
    case "too_big": {
      const max = num(issue.maximum);
      if (kind === "string") return `${name} can be at most ${max} characters`;
      if (kind === "array" || kind === "set") return `Use at most ${max} ${name.toLowerCase()}`;
      if (kind === "date") return `${name} is too late`;
      if (kind === "number" || kind === "bigint" || kind === "int") {
        return issue.inclusive === false ? `${name} must be less than ${max}` : `${name} must be ${max} or less`;
      }
      return `${name} is too large`;
    }
    case "invalid_type": {
      const missing =
        issue.received === "undefined" ||
        issue.received === "null" ||
        (issue.received === undefined && "input" in issue && (issue.input === undefined || issue.input === null));
      if (missing) return `${name} is required`;
      switch (issue.expected) {
        case "number":
        case "bigint":
          return `${name} must be a number`;
        case "int":
        case "integer":
          return `${name} must be a whole number`;
        case "boolean":
          return `Choose yes or no for ${name.toLowerCase()}`;
        case "string":
          return `${name} must be text`;
        case "date":
          return `${name} must be a date`;
        default:
          return `${name} isn't valid`;
      }
    }
    case "invalid_enum_value":
    case "invalid_value": {
      const raw = issue.options ?? issue.values;
      const values: readonly unknown[] = Array.isArray(raw) ? raw : [];
      return values.length > 0 ? `Choose one of: ${listOf(values)}` : `Choose a valid ${name.toLowerCase()}`;
    }
    case "invalid_literal":
      return `${name} isn't valid`;
    case "invalid_string":
      return formatMessage(name, typeof issue.validation === "string" ? issue.validation : "regex");
    case "invalid_format":
      return formatMessage(name, issue.format);
    case "not_multiple_of":
      return `${name} must be a multiple of ${num(issue.multipleOf ?? issue.divisor)}`;
    case "invalid_date":
      return "Enter a valid date";
    case "unrecognized_keys":
      return `${name} has settings that aren't recognised`;
    case "custom":
      // Refinement messages are written by field-type authors for people.
      return issue.message?.trim() ? sentence(issue.message.trim()) : `${name} isn't valid`;
    default:
      return `${name} isn't valid`;
  }
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Whether an error at `path` may show, given the dot-paths the user has
 * left: its own path, or any field in the same list row (`options.2.*`), so
 * a row-level problem reported on `options.2.id` shows once the row's name
 * input was blurred.
 */
export function isPathTouched(path: string, touched: ReadonlySet<string>): boolean {
  if (touched.has(path)) return true;
  const segments = path.split(".");
  const rowEnd = segments.findIndex((s) => /^\d+$/.test(s));
  if (rowEnd < 0) return false;
  const rowPrefix = `${segments.slice(0, rowEnd + 1).join(".")}.`;
  for (const t of touched) if (t.startsWith(rowPrefix)) return true;
  return false;
}

/** Dot-path → friendly message, first issue per path wins (`""` = the whole object). */
export function zodIssuesToErrors(issues: readonly ZodIssueLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (!(key in out)) out[key] = humanizeZodIssue(issue);
  }
  return out;
}
