/** Column keys: lowercase snake_case starting with a letter. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function slugifyKey(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "col";
  return /^[0-9]/.test(slug) ? `col_${slug}` : slug;
}

export function uniqueKey(base: string, existingKeys: Iterable<string>): string {
  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
