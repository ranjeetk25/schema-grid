import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Tailwind utility must carry the `sg:` prefix, or the prebuilt CSS will
 * silently lack it. Scans string literals in className=/cn()/cva() contexts of
 * all non-test .tsx/.ts sources and reports bare tokens. Hook classes
 * (`sg-*`, `ag-*`, `dark`, `group`, `peer`) are allowed.
 */
const SRC = join(__dirname, "..");
const ALLOWED = /^(sg:|sg-|ag-|dark$|group(\/|$)|peer$)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|ts)$/.test(name) && !/\.test\.|\/test\//.test(p) ? [p] : [];
  });
}

/** String literals that look like class lists: contain a `sg:` token somewhere, or sit in className="…". */
function classStrings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/className="([^"]*)"/g)) out.push(m[1] ?? "");
  for (const m of src.matchAll(/"([^"\n]*\bsg:[^"\n]*)"/g)) out.push(m[1] ?? "");
  return out;
}

describe("sg: prefix guard", () => {
  it("has no un-prefixed Tailwind tokens in class strings", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      for (const s of classStrings(readFileSync(file, "utf8"))) {
        for (const token of s.split(/\s+/).filter(Boolean)) {
          if (!ALLOWED.test(token)) offenders.push(`${file.slice(SRC.length + 1)}: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
