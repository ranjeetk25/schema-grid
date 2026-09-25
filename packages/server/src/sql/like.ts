/** Escapes LIKE wildcards with backslash (MySQL's default ESCAPE character). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
