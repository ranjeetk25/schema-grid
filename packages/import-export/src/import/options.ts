export interface OptionLike {
  value: string;
  label: string;
}

/** Trim, collapse whitespace runs and lowercase, for option comparison. */
function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Finds the option `raw` refers to: a case- and whitespace-insensitive match on
 * the label first, then on the value. Returns null when nothing matches.
 */
export function matchOption<T extends OptionLike>(
  raw: string,
  options: readonly T[],
): T | null {
  const needle = norm(raw);
  if (needle === "") return null;
  return (
    options.find((o) => norm(o.label) === needle) ??
    options.find((o) => norm(o.value) === needle) ??
    null
  );
}

/**
 * Splits a multi-value cell on `,` or `;`, trims each piece, drops empty ones,
 * and removes case-insensitive duplicates keeping the first spelling.
 */
export function splitMulti(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[,;]/)) {
    const p = piece.trim();
    if (p === "") continue;
    const k = norm(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * Adds `label` to `list` unless an equal label (case/whitespace-insensitive) is
 * already there. Returns the spelling kept in the list.
 */
export function addNewOption(list: string[], label: string): string {
  const k = norm(label);
  const existing = list.find((l) => norm(l) === k);
  if (existing !== undefined) return existing;
  list.push(label);
  return label;
}
