const CSV_TRIGGER_RE =
  /^[\s\u00A0\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/;

/**
 * OWASP CSV injection guard: prefix `'` when text starts with a formula
 * trigger (`=`, `+`, `-`, `@`, their full-width forms, tab/CR/LF), including
 * after leading whitespace, which some importers trim before evaluating.
 */
export function sanitizeCsvText(s: string): string {
  return CSV_TRIGGER_RE.test(s) ? `'${s}` : s;
}
