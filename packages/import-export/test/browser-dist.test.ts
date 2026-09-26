/**
 * The `browser` condition of `@ranjeetk25/schema-grid-io` (v0.3.1) maps to
 * `dist/index.browser.*` and `dist/export/index.browser.*`. Those files, and
 * every chunk they reach, must never mention a `node:` specifier, or Vite
 * warns ("externalized for browser compatibility") in every consumer. The
 * Node entries must still carry the `node:stream` path, so the split cannot
 * silently drop the streaming writers.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as browserEntry from "../src/export/index.browser";
import * as nodeEntry from "../src/export/index";
import { makeRegistry } from "./helpers/registry";
import { makeAccess, makeRow, sampleCells, visibleColumns } from "./helpers/schema";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

const BROWSER_ENTRIES = [
  "index.browser.js",
  "index.browser.cjs",
  "export/index.browser.js",
  "export/index.browser.cjs",
];
const NODE_ENTRIES = ["index.js", "index.cjs", "export/index.js", "export/index.cjs"];

/**
 * A `node:` specifier, or the bare `stream` built-in: tsup 8 strips the
 * `node:` prefix from externals by default (`removeNodeProtocol`), so in dist
 * the streaming path reads `import('stream')`. Vite warns on either spelling.
 */
const NODE_SPECIFIER = /["']node:|(?:import\s*\(|require\s*\(|from\s*)\s*["']stream["']/;
const STREAM_SPECIFIER = /(?:import\s*\(|require\s*\(|from\s*)\s*["'](?:node:)?stream["']/;

/** Relative specifiers of static imports, dynamic imports and requires. */
function relativeSpecifiers(text: string): string[] {
  const out: string[] = [];
  const re =
    /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for (const m of text.matchAll(re)) out.push(m[1] as string);
  return out;
}

/** `file` plus every dist file it reaches through relative specifiers. */
function closure(file: string): string[] {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    for (const spec of relativeSpecifiers(readFileSync(f, "utf8"))) {
      visit(resolve(dirname(f), spec));
    }
  };
  visit(file);
  return [...seen];
}

const distBuilt = BROWSER_ENTRIES.every((e) => existsSync(join(DIST, e)));

describe.skipIf(!distBuilt)(
  "browser dist (skipped when dist/ is absent: run `bun run build` in packages/import-export)",
  () => {
    it.each(BROWSER_ENTRIES)("%s and its chunks contain no node: specifier", (entry) => {
      const files = closure(join(DIST, entry));
      expect(files.length).toBeGreaterThan(1);
      const hits = files
        .filter((f) => NODE_SPECIFIER.test(readFileSync(f, "utf8")))
        .map((f) => relative(DIST, f));
      expect(hits).toEqual([]);
    });

    it.each(NODE_ENTRIES)("%s still reaches the stream writers (node:stream / stream)", (entry) => {
      const files = closure(join(DIST, entry));
      const hits = files.filter((f) => STREAM_SPECIFIER.test(readFileSync(f, "utf8")));
      expect(hits.length).toBeGreaterThan(0);
    });
  },
);

describe("./export browser entry (source)", () => {
  it("exports the same runtime names as the Node entry", async () => {
    expect(Object.keys(browserEntry).sort()).toEqual(Object.keys(nodeEntry).sort());
  });

  it("buildExportStream rejects with a clear message", async () => {
    await expect(
      browserEntry.buildExportStream({
        columns: visibleColumns(),
        registry: makeRegistry(),
        rows: [makeRow(sampleCells(0))],
        format: "csv",
        tz: "Asia/Kolkata",
        fileName: "leads.csv",
        access: makeAccess(),
      }),
    ).rejects.toThrow(/not available in the browser/);
  });

  it("buildExport is the Blob builder", async () => {
    const blob = await browserEntry.buildExport({
      columns: visibleColumns(),
      registry: makeRegistry(),
      rows: [makeRow(sampleCells(0))],
      format: "csv",
      tz: "Asia/Kolkata",
      fileName: "leads.csv",
      access: makeAccess(),
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv;charset=utf-8");
  });
});
