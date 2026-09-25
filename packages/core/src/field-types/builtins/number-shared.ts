import type { ParseResult } from "../types";

/**
 * Parses free-form numeric text: strips surrounding whitespace, a leading
 * currency symbol (₹, $, €, £) or ISO code (e.g. "INR "), grouping
 * separators (both "1,234,567" and Indian "1,23,456" — both are just comma
 * removal), and reads parenthesised or minus-prefixed values as negative.
 * Returns `null` when the remainder isn't a plain number. Never rounds.
 */
export function parseNumericText(text: string): number | null {
  let s = text.trim();
  if (s.length === 0) return null;

  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1] ?? "";
    s = s.trim();
  }

  s = s.trim();
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Leading currency symbol or 3-letter ISO code, optionally followed by whitespace.
  s = s.replace(/^(₹|\$|€|£|[A-Za-z]{3})\s*/, "");
  s = s.trim();

  // Grouping separators: plain comma removal handles both western and Indian grouping.
  s = s.replace(/,/g, "");

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Parses a raw field-value input (already-typed number, numeric text, or
 * empty) into `number | null`. Never throws.
 */
export function parseNumberInput(input: unknown): ParseResult<number | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, error: "Invalid number" };
    return { ok: true, value: input };
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length === 0) return { ok: true, value: null };
    const n = parseNumericText(trimmed);
    if (n === null) return { ok: false, error: `Cannot parse "${input}" as a number` };
    return { ok: true, value: n };
  }
  return { ok: false, error: "Invalid number" };
}

/**
 * Linear fill series over numeric seeds (empties already filtered out by
 * the caller — see `filterNumericSeeds`):
 * - No seeds -> `[]`.
 * - One seed -> that value repeated `count` times.
 * - Two+ seeds -> continues the arithmetic step between the last two.
 */
export function fillSeriesLinear(seeds: number[], count: number): number[] {
  if (seeds.length === 0) return [];
  if (seeds.length === 1) {
    const only = seeds[0] as number;
    return Array.from({ length: count }, () => only);
  }
  const last = seeds[seeds.length - 1] as number;
  const prev = seeds[seeds.length - 2] as number;
  const step = last - prev;
  const out: number[] = [];
  let cur = last;
  for (let i = 0; i < count; i++) {
    cur += step;
    out.push(cur);
  }
  return out;
}

/** Filters a raw values array down to finite, non-empty numeric seeds. */
export function filterNumericSeeds(values: (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}
