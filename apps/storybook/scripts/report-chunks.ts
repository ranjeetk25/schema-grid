/**
 * Bundle report for the Storybook build — run through `bun run analyze`
 * (root) which builds with ANALYZE=1 first.
 *
 *   1. Every JS chunk under storybook-static/: raw + gzip size, largest first,
 *      split into the preview bundle (our code + deps) and Storybook's own
 *      manager UI, with totals.
 *   2. Per-package rendered size, from bundle-stats.json (rollup-plugin-visualizer
 *      `raw-data`): what each dependency contributes after tree-shaking.
 *   3. AG Grid: which Community modules ended up in the bundle (detected by their
 *      `moduleName` in the emitted chunks) against the lists in
 *      packages/ag-grid/src/agModules.ts plus their transitive `dependsOn` (and the
 *      CommunityCore baseline that `createGrid` always registers).
 *
 *   bun scripts/report-chunks.ts            # from apps/storybook
 *   bun scripts/report-chunks.ts --json     # machine-readable summary on stdout
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const APP_DIR = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(APP_DIR, "../..");
const OUT_DIR = join(APP_DIR, "storybook-static");
const STATS_JSON = join(OUT_DIR, "bundle-stats.json");
const AG_MODULES_TS = join(REPO_ROOT, "packages/ag-grid/src/agModules.ts");

interface Chunk {
  file: string;
  group: "preview" | "storybook-manager";
  raw: number;
  gzip: number;
}

const kb = (n: number) => (n / 1024).toFixed(1).padStart(9);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(m?js)$/.test(entry)) out.push(full);
  }
  return out;
}

function chunks(): Chunk[] {
  return walk(OUT_DIR)
    .map((full) => {
      const buf = readFileSync(full);
      const file = relative(OUT_DIR, full);
      // Storybook's manager UI ships prebuilt under sb-*; everything else
      // (assets/, iframe entry) is the Vite preview build of our stories.
      const group: Chunk["group"] = file.startsWith("sb-") ? "storybook-manager" : "preview";
      return { file, group, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
    })
    .sort((a, b) => b.raw - a.raw);
}

// ---- visualizer raw-data -------------------------------------------------

interface RawData {
  nodeParts: Record<string, { renderedLength: number; gzipLength: number; metaUid: string }>;
  nodeMetas: Record<string, { id: string; moduleParts: Record<string, string> }>;
}

interface ModuleSize {
  id: string;
  rendered: number;
  gzip: number;
}

function moduleSizes(): ModuleSize[] | null {
  let data: RawData;
  try {
    data = JSON.parse(readFileSync(STATS_JSON, "utf8")) as RawData;
  } catch {
    return null;
  }
  const out: ModuleSize[] = [];
  for (const meta of Object.values(data.nodeMetas)) {
    let rendered = 0;
    let gzip = 0;
    for (const partUid of Object.values(meta.moduleParts)) {
      const part = data.nodeParts[partUid];
      if (!part) continue;
      rendered += part.renderedLength;
      gzip += part.gzipLength;
    }
    out.push({ id: meta.id, rendered, gzip });
  }
  return out;
}

function packageOf(id: string): string {
  const nm = id.lastIndexOf("node_modules/");
  if (nm >= 0) {
    const rest = id.slice(nm + "node_modules/".length).split("/");
    return rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : (rest[0] ?? id);
  }
  const ws = /(?:^|\/)(packages|apps)\/([^/]+)\//.exec(id);
  if (ws) return `${ws[1]}/${ws[2]}`;
  return "(other)";
}

// ---- AG Grid modules -----------------------------------------------------

/** `var FooModule = { moduleName: "Foo", ... dependsOn: [A, B] }` → var → {name, deps}. */
function agModuleGraph(): Map<string, { name: string; deps: string[] }> {
  const pkgJson = Bun.resolveSync("ag-grid-community/package.json", APP_DIR);
  const src = readFileSync(join(dirname(pkgJson), "dist/package/main.esm.mjs"), "utf8");
  const graph = new Map<string, { name: string; deps: string[] }>();
  const re = /var (\w+) = \{\n\s+moduleName: "(\w+)"([\s\S]*?)\n\};/g;
  for (const m of src.matchAll(re)) {
    const [, varName, name, body] = m as unknown as [string, string, string, string];
    const deps = /dependsOn: \[([^\]]*)\]/.exec(body)?.[1] ?? "";
    graph.set(varName, {
      name,
      deps: deps
        .split(",")
        .map((d) => d.trim())
        .filter((d) => /^\w+$/.test(d)),
    });
  }
  return graph;
}

function listedModules(): { client: string[]; infinite: string[] } {
  const src = readFileSync(AG_MODULES_TS, "utf8");
  const arr = (name: string) => {
    const body = new RegExp(`${name}: readonly Module\\[\\] = \\[([\\s\\S]*?)\\];`).exec(src)?.[1] ?? "";
    return [...body.matchAll(/(\.\.\.)?(\w+)/g)].map((m) => (m[1] ? `...${m[2]}` : (m[2] as string)));
  };
  const shared = arr("SHARED_MODULES");
  const expand = (xs: string[]) => xs.flatMap((x) => (x === "...SHARED_MODULES" ? shared : [x]));
  return {
    client: expand(arr("SCHEMA_GRID_CLIENT_MODULES")),
    infinite: expand(arr("SCHEMA_GRID_INFINITE_MODULES")),
  };
}

function closure(roots: string[], graph: Map<string, { name: string; deps: string[] }>): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const v = stack.pop() as string;
    const node = graph.get(v);
    if (!node || seen.has(node.name)) continue;
    seen.add(node.name);
    stack.push(...node.deps);
  }
  return seen;
}

function modulesInBundle(files: Chunk[]): Set<string> {
  const found = new Set<string>();
  for (const c of files) {
    if (c.group !== "preview") continue;
    const text = readFileSync(join(OUT_DIR, c.file), "utf8");
    for (const m of text.matchAll(/moduleName:\s*"(\w+)"/g)) found.add(m[1] as string);
  }
  return found;
}

// ---- report --------------------------------------------------------------

const all = chunks();
if (all.length === 0) {
  console.error(`No JS under ${OUT_DIR} — run \`bun run analyze\` from the repo root.`);
  process.exit(1);
}
const sizes = moduleSizes();
const graph = agModuleGraph();
const listed = listedModules();
const nameOf = (v: string) => graph.get(v)?.name ?? `?${v}`;
const listedNames = new Set([...listed.client, ...listed.infinite].map(nameOf));
// createGrid always registers CommunityCoreModule (and its dependsOn) itself,
// whatever `modules` we pass — it is the grid's baseline, not a choice of ours.
const IMPLICIT_ROOT = "CommunityCoreModule";
const coreClosure = closure([IMPLICIT_ROOT], graph);
const expected = closure([...listed.client, ...listed.infinite, IMPLICIT_ROOT], graph);
const found = modulesInBundle(all);
const unexpected = [...found].filter((n) => !expected.has(n)).sort();
const missing = [...listedNames].filter((n) => !found.has(n)).sort();

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        chunks: all,
        agGrid: { listed: [...listedNames].sort(), core: [...coreClosure].sort(), expected: [...expected].sort(), found: [...found].sort(), unexpected, missing },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

for (const group of ["preview", "storybook-manager"] as const) {
  const rows = all.filter((c) => c.group === group);
  const raw = rows.reduce((s, c) => s + c.raw, 0);
  const gz = rows.reduce((s, c) => s + c.gzip, 0);
  console.log(`\n== JS chunks: ${group} (${rows.length} files)`);
  console.log(`${"raw KB".padStart(9)} ${"gzip KB".padStart(9)}  file`);
  const shown = group === "preview" ? rows.slice(0, 25) : rows.slice(0, 8);
  for (const c of shown) console.log(`${kb(c.raw)} ${kb(c.gzip)}  ${c.file}`);
  if (rows.length > shown.length) {
    const rest = rows.slice(shown.length);
    console.log(
      `${kb(rest.reduce((s, c) => s + c.raw, 0))} ${kb(rest.reduce((s, c) => s + c.gzip, 0))}  (${rest.length} smaller files)`,
    );
  }
  console.log(`${kb(raw)} ${kb(gz)}  TOTAL ${group}`);
}

if (sizes) {
  const byPkg = new Map<string, { rendered: number; gzip: number; modules: number }>();
  for (const m of sizes) {
    const p = packageOf(m.id);
    const cur = byPkg.get(p) ?? { rendered: 0, gzip: 0, modules: 0 };
    cur.rendered += m.rendered;
    cur.gzip += m.gzip;
    cur.modules += m.rendered > 0 ? 1 : 0;
    byPkg.set(p, cur);
  }
  console.log("\n== Rendered size by package (preview bundle, after tree-shaking; top 20)");
  console.log(`${"KB".padStart(9)} ${"gzip KB".padStart(9)} ${"modules".padStart(8)}  package`);
  for (const [p, v] of [...byPkg].sort((a, b) => b[1].rendered - a[1].rendered).slice(0, 20)) {
    console.log(`${kb(v.rendered)} ${kb(v.gzip)} ${String(v.modules).padStart(8)}  ${p}`);
  }
  for (const pkg of ["@tabler/icons-react", "ag-grid-community"]) {
    const files = sizes.filter((m) => packageOf(m.id) === pkg && m.rendered > 0);
    const total = files.reduce((s, m) => s + m.rendered, 0);
    console.log(`\n== ${pkg}: ${files.length} source files in bundle, ${kb(total).trim()} KB rendered`);
    for (const m of files.sort((a, b) => b.rendered - a.rendered).slice(0, 10)) {
      console.log(`${kb(m.rendered)}  ${m.id.slice(m.id.lastIndexOf("node_modules/") + 13)}`);
    }
    if (files.length > 10) console.log(`           … ${files.length - 10} more`);
  }
} else {
  console.log(`\n(no ${relative(APP_DIR, STATS_JSON)} — build with ANALYZE=1 for per-package sizes)`);
}

console.log("\n== AG Grid Community modules (agModules.ts vs bundle)");
console.log(`client list   (${listed.client.length}): ${listed.client.map(nameOf).join(", ")}`);
console.log(`infinite list (${listed.infinite.length}): ${listed.infinite.map(nameOf).join(", ")}`);
const deps = [...closure([...listed.client, ...listed.infinite], graph)].filter((n) => !listedNames.has(n)).sort();
console.log(`transitive dependsOn of the lists (${deps.length}): ${deps.join(", ")}`);
const coreOnly = [...coreClosure].filter((n) => !listedNames.has(n) && !deps.includes(n)).sort();
console.log(`CommunityCore baseline, always registered by createGrid (${coreOnly.length}): ${coreOnly.join(", ")}`);
console.log(`found in bundle (${found.size}): ${[...found].sort().join(", ")}`);
console.log(`listed but NOT found: ${missing.length ? missing.join(", ") : "none"}`);
console.log(
  `found but NOT listed/required: ${unexpected.length ? unexpected.join(", ") : "none — only the listed modules and their dependencies are bundled"}`,
);
