/**
 * String normalisation helpers for autoMapColumns (see plan "Task 6").
 */

/** Lowercase, strip accents (NFKD), and keep only letters and digits. */
export function normalizeLabel(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Splits on camelCase boundaries, whitespace, punctuation/underscore/hyphen,
 * and letter/digit transitions, then lowercases and drops empty tokens.
 */
export function tokenize(s: string): string[] {
  if (!s) return [];
  const withBoundaries = s
    // lower/digit -> upper: "paymentStatus" -> "payment Status"
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    // acronym run -> upper+lower: "HTTPServer" -> "HTTP Server"
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    // letter <-> digit
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2");
  return withBoundaries
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Edit distance between `a` and `b` (Levenshtein extended with adjacent
 * transpositions — "optimal string alignment" — so the common typo "Emial"
 * vs "Email" costs 1, not 2). When `max` is given, returns early with a value
 * greater than `max` once the distance is known to exceed it.
 */
export function levenshtein(a: string, b: string, max?: number): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return max !== undefined && bl > max ? max + 1 : bl;
  if (bl === 0) return max !== undefined && al > max ? max + 1 : al;
  if (max !== undefined && Math.abs(al - bl) > max) return max + 1;

  let prev2: number[] = [];
  let prev: number[] = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    const curr: number[] = new Array(bl + 1);
    curr[0] = i;
    let rowMin = i;
    const aChar = a[i - 1];
    for (let j = 1; j <= bl; j++) {
      const cost = aChar === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && aChar === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (prev2[j - 2] ?? 0) + 1);
      }
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    // A transposition can reach back two rows, so only stop once two
    // consecutive rows both exceed `max`.
    if (max !== undefined && rowMin > max && Math.min(...prev) > max) {
      return max + 1;
    }
    prev2 = prev;
    prev = curr;
  }
  const d = prev[bl] ?? 0;
  return max !== undefined && d > max ? max + 1 : d;
}

/**
 * True when `short` (length >= 3) shares its first letter with `long` and its
 * letters appear, in order, somewhere inside `long`.
 */
export function isAbbreviation(short: string, long: string): boolean {
  if (short.length < 3) return false;
  if (short[0] !== long[0]) return false;
  let cursor = 0;
  for (const ch of short) {
    const found = long.indexOf(ch, cursor);
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
}
