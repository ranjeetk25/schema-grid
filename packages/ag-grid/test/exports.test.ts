import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pkgRoot = join(__dirname, "..");

describe("public barrels", () => {
  it("root exposes the plan's surface", async () => {
    const mod = await import("../src/index");
    for (const name of [
      "SchemaGrid",
      "useSchemaGrid",
      "compileColumns",
      "createDefaultUiRegistry",
      "captureViewState",
      "applyViewState",
      "exportCsv",
      "exportCurrentView",
      "createSchemaGridTheme",
      "SG_CLASSES",
      "SCHEMA_GRID_CLIENT_MODULES",
      "SCHEMA_GRID_INFINITE_MODULES",
      "createRowStore",
      "createCellStatusStore",
      "createRangeStore",
      "createQueryStore",
      "createExpansionStore",
      "planPaste",
      "planFill",
      "parseTsv",
      "serializeTsv",
      "createUndoStack",
      "createHttpDataSource",
      "createGridClient",
      "createRemoteDataSource",
      "RemoteDataSourceError",
      "unwrapWireResult",
    ]) {
      expect(mod, name).toHaveProperty(name);
      expect((mod as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("./editors exposes editors, createPopupEditor and ComboboxEditor", async () => {
    const mod = await import("../src/editors/index");
    for (const name of [
      "createPopupEditor",
      "ComboboxEditor",
      "TextEditor",
      "LongTextEditor",
      "NumberEditor",
      "BooleanEditor",
      "DateEditor",
      "SelectEditor",
      "MultiSelectEditor",
      "DEFAULT_EDITORS",
    ]) {
      expect((mod as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("./filters exposes filter components and AST conversion", async () => {
    const mod = await import("../src/filters/index");
    for (const name of ["ConditionFilter", "SetFilter", "FloatingFilter", "filterModelToAst", "astToFilterModel", "DEFAULT_FILTERS"]) {
      expect((mod as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("./sync exposes polling pieces", async () => {
    const mod = await import("../src/sync/index");
    for (const name of ["usePollingSync", "planRemotePatch", "useDocumentVisible"]) {
      expect((mod as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("package.json maps each subpath to its source in development", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      exports: Record<string, { development: string; import: string; require: string; types: string }>;
    };
    for (const [sub, src] of [
      [".", "./src/index.ts"],
      ["./editors", "./src/editors/index.ts"],
      ["./filters", "./src/filters/index.ts"],
      ["./sync", "./src/sync/index.ts"],
    ] as const) {
      expect(pkg.exports[sub]?.development).toBe(src);
      expect(existsSync(join(pkgRoot, src))).toBe(true);
    }
  });

  /** Runtime (non type-only) relative import graph from an entry. */
  function runtimeGraph(entry: string): Set<string> {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      const re = /^(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+"(\.[^"]+)"/gms;
      for (const m of src.matchAll(re)) {
        const spec = m[2] as string;
        const base = resolve(dirname(file), spec);
        const candidate = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p));
        if (candidate) visit(candidate);
      }
    };
    visit(entry);
    return seen;
  }

  it.each(["filters", "editors", "sync"])("importing ./%s doesn't pull in the grid component", (sub) => {
    const graph = [...runtimeGraph(join(pkgRoot, "src", sub, "index.ts"))].map((f) => f.slice(pkgRoot.length));
    expect(graph.some((f) => f.endsWith("grid/SchemaGrid.tsx"))).toBe(false);
    expect(graph.some((f) => f.endsWith("grid/useSchemaGrid.ts"))).toBe(false);
  });
});

describe("build output (run `bun run build` first; skipped when dist/ is absent)", () => {
  const dist = join(pkgRoot, "dist");
  it.skipIf(!existsSync(dist))("emits ESM, CJS and d.ts for the 4 entries", () => {
    for (const entry of ["index", "editors/index", "filters/index", "sync/index"]) {
      for (const ext of [".js", ".cjs", ".d.ts", ".d.cts"]) {
        expect(existsSync(join(dist, `${entry}${ext}`)), `${entry}${ext}`).toBe(true);
      }
    }
  });
});

describe("SCHEMA_GRID_AG_GRID_VERSION", () => {
  it("equals the package.json version (injected via tsup/vitest `define`)", async () => {
    const { version } = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string };
    const mod = await import("../src/index");
    expect(mod.SCHEMA_GRID_AG_GRID_VERSION).toBe(version);
  });
});
