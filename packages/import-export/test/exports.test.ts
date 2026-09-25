import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as clipboard from "../src/clipboard/index";
import * as exp from "../src/export/index";
import * as imp from "../src/import/index";
import * as root from "../src/index";

const IMPORT_NAMES = [
  "ImportConfigError",
  "KEY_COLUMN_TYPES",
  "SheetNotFoundError",
  "autoMapColumns",
  "buildErrorReportCsv",
  "chunkRows",
  "createImportJobState",
  "keyOf",
  "parseFile",
  "recordChunkResult",
  "toChangeBatches",
  "validateRows",
];
const EXPORT_NAMES = [
  "HiddenColumnError",
  "buildExport",
  "buildExportBlob",
  "buildExportStream",
  "exportFileName",
  "exportMimeType",
];
const CLIPBOARD_NAMES = [
  "formatForClipboard",
  "formatMatrixForClipboard",
  "parseClipboard",
];

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function importsOf(file: string, runtimeOnly = false): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  const re =
    /(?:import|export)\s([^;]*?)from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of text.matchAll(re)) {
    // Type-only imports are erased and add no runtime dependency.
    if (!runtimeOnly || !/^type\s/.test(m[1] ?? "")) specs.push((m[2] ?? m[3]) as string);
  }
  return specs;
}

describe("package surface", () => {
  it("./import exports exactly the documented runtime names", () => {
    expect(Object.keys(imp).sort()).toEqual(IMPORT_NAMES);
  });
  it("./export exports exactly the documented runtime names", () => {
    expect(Object.keys(exp).sort()).toEqual(EXPORT_NAMES);
  });
  it("./clipboard exports exactly the documented runtime names", () => {
    expect(Object.keys(clipboard).sort()).toEqual(CLIPBOARD_NAMES);
  });
  it(". re-exports every subpath", () => {
    expect(Object.keys(root).sort()).toEqual(
      [...new Set([...IMPORT_NAMES, ...EXPORT_NAMES, ...CLIPBOARD_NAMES])].sort(),
    );
  });
});

describe("dependency hygiene", () => {
  it("./clipboard pulls in no exceljs, papaparse or node: modules (transitively)", () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of importsOf(file, true)) {
        if (spec.startsWith(".")) {
          visit(join(file, "..", `${spec}.ts`));
        } else {
          bad.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    };
    visit(join(SRC, "clipboard/index.ts"));
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("only src/internal/core.ts may import @masai/schema-grid-core", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => importsOf(f).some((s) => s.startsWith("@masai/schema-grid-core")))
      .map((f) => relative(SRC, f))
      .filter((f) => f !== join("internal", "core.ts"));
    expect(offenders).toEqual([]);
  });

  it("node:stream is only loaded dynamically in runtime code", () => {
    for (const f of sourceFiles(SRC)) {
      const text = readFileSync(f, "utf8");
      const staticValue = /^import\s+(?!type\b)[^;]*from\s+["']node:/m.test(text);
      expect(staticValue, relative(SRC, f)).toBe(false);
    }
  });
});
