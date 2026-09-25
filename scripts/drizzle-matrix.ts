/**
 * Drizzle peer-range matrix (spec v0.2 §C9). For every requested drizzle-orm
 * version it installs that version for `packages/server` and runs the server
 * typecheck + unit suite against it, then prints a summary table.
 *
 *   bun scripts/drizzle-matrix.ts                  # 0.41.0 and 0.45, scratch copies
 *   bun scripts/drizzle-matrix.ts 0.41.0           # just one version
 *   bun scripts/drizzle-matrix.ts --keep 0.41.0    # keep the scratch copy afterwards
 *   bun scripts/drizzle-matrix.ts --in-place 0.45  # mutate THIS checkout (CI only)
 *
 * By default each version runs in a fresh copy of the working tree (every file
 * `git ls-files -co --exclude-standard` lists, so new untracked files count;
 * node_modules/dist/.git are never copied) under `$SCHEMA_GRID_MATRIX_DIR` or
 * the OS temp dir, followed by a `bun install` there. The working tree itself
 * is never touched. `--in-place` skips the copy and runs `bun add` in this
 * checkout — it rewrites package.json/bun.lock, so only use it where the
 * checkout is thrown away (the CI `drizzle-matrix` job).
 *
 * Exits 1 when any version fails to resolve, typecheck or pass its tests.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const SERVER_REL = "packages/server";
const DEFAULT_VERSIONS = ["0.41.0", "0.45"];

const argv = process.argv.slice(2);
const inPlace = argv.includes("--in-place");
const keep = argv.includes("--keep");
const unknownFlags = argv.filter(
  (a) => a.startsWith("-") && a !== "--in-place" && a !== "--keep",
);
if (unknownFlags.length > 0) {
  console.error(`Unknown flag(s): ${unknownFlags.join(", ")}`);
  process.exit(2);
}
const versions = argv.filter((a) => !a.startsWith("-"));
if (versions.length === 0) versions.push(...DEFAULT_VERSIONS);
if (inPlace && versions.length > 1) {
  console.error(
    "--in-place mutates the checkout, so it takes exactly one version (one CI matrix leg each).",
  );
  process.exit(2);
}

interface RunResult {
  ok: boolean;
  output: string;
}

interface VersionReport {
  version: string;
  resolved: string;
  install: boolean;
  typecheck: boolean | null;
  tests: boolean | null;
  testCounts: string;
  seconds: number;
  dir: string;
  errors: string[];
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour codes
const ANSI = /\u001b\[[0-9;]*m/g;

function run(cmd: string, args: string[], cwd: string): RunResult {
  console.log(`  $ ${cmd} ${args.join(" ")}   (cwd: ${cwd})`);
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(ANSI, "");
  if (res.error)
    return { ok: false, output: `${output}\n${res.error.message}` };
  return { ok: res.status === 0, output };
}

function tail(text: string, lines = 60): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

/** Copies every non-ignored file of the working tree into `dest`. */
function copyWorkingTree(dest: string): number {
  const listed = run(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    REPO_ROOT,
  );
  if (!listed.ok) throw new Error(`git ls-files failed:\n${listed.output}`);
  let count = 0;
  for (const rel of new Set(listed.output.split("\0").filter(Boolean))) {
    const src = join(REPO_ROOT, rel);
    if (!existsSync(src)) continue; // tracked but deleted in the working tree
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true });
    const stat = lstatSync(src);
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(src), target);
    else if (stat.isFile()) copyFileSync(src, target);
    else continue; // submodule dirs etc.
    count++;
  }
  return count;
}

function installedVersion(pkgJson: string): string | null {
  if (!existsSync(pkgJson)) return null;
  return (JSON.parse(readFileSync(pkgJson, "utf8")) as { version: string })
    .version;
}

/** The drizzle-orm version `packages/server` code actually resolves to. */
function resolvedDrizzle(root: string): {
  resolved: string | null;
  where: string;
} {
  const serverDir = join(root, SERVER_REL);
  try {
    const req = createRequire(join(serverDir, "package.json"));
    const pkgJson = req.resolve("drizzle-orm/package.json");
    return { resolved: installedVersion(pkgJson), where: pkgJson };
  } catch (err) {
    return { resolved: null, where: String(err) };
  }
}

function matchesRequest(resolvedVersion: string, requested: string): boolean {
  return Bun.semver.satisfies(resolvedVersion, requested);
}

function vitestCounts(output: string): string {
  const files = output.match(/Test Files\s+(.+?)\s*\(\d+\)/);
  const tests = output.match(/\n\s*Tests\s+(.+?)\s*\((\d+)\)/);
  if (!tests) return "no summary";
  return `${tests[1]} (${tests[2]})${files ? `, files: ${files[1]}` : ""}`;
}

function typeErrors(output: string): string[] {
  return output
    .split("\n")
    .filter((l) => /error TS\d+/.test(l))
    .map((l) => l.trim());
}

function runVersion(version: string, scratchRoot: string): VersionReport {
  const started = performance.now();
  const report: VersionReport = {
    version,
    resolved: "-",
    install: false,
    typecheck: null,
    tests: null,
    testCounts: "-",
    seconds: 0,
    dir: REPO_ROOT,
    errors: [],
  };
  const finish = () => {
    report.seconds = (performance.now() - started) / 1000;
    return report;
  };

  console.log(`\n=== drizzle-orm@${version} ===`);
  let root = REPO_ROOT;
  if (!inPlace) {
    root = mkdtempSync(
      join(scratchRoot, `schema-grid-drizzle-${version.replace(/\W/g, "_")}-`),
    );
    report.dir = root;
    const n = copyWorkingTree(root);
    console.log(`  copied ${n} files -> ${root}`);
    const install = run("bun", ["install"], root);
    if (!install.ok) {
      report.errors.push(`bun install failed:\n${tail(install.output)}`);
      return finish();
    }
  }

  const serverDir = join(root, SERVER_REL);
  const add = run("bun", ["add", "-d", `drizzle-orm@${version}`], serverDir);
  if (!add.ok) {
    report.errors.push(
      `bun add drizzle-orm@${version} failed:\n${tail(add.output)}`,
    );
    return finish();
  }

  const rootCopy = installedVersion(
    join(root, "node_modules/drizzle-orm/package.json"),
  );
  const serverCopy = installedVersion(
    join(serverDir, "node_modules/drizzle-orm/package.json"),
  );
  const { resolved, where } = resolvedDrizzle(root);
  console.log(
    `  node_modules/drizzle-orm: root=${rootCopy ?? "none"} ${SERVER_REL}=${serverCopy ?? "none"}; server resolves ${resolved ?? "nothing"} (${where})`,
  );
  report.resolved = resolved ?? "none";
  if (!resolved || !matchesRequest(resolved, version)) {
    report.errors.push(
      `packages/server resolves drizzle-orm ${resolved ?? "(nothing)"} from ${where}, expected ${version}`,
    );
    return finish();
  }
  report.install = true;

  const tsc = run(
    "bunx",
    ["tsc", "--noEmit", "-p", "tsconfig.json"],
    serverDir,
  );
  report.typecheck = tsc.ok;
  if (!tsc.ok) {
    const errs = typeErrors(tsc.output);
    report.errors.push(
      `typecheck failed (${errs.length} error(s)):\n${errs.length ? errs.join("\n") : tail(tsc.output)}`,
    );
  }

  const vitest = run("bunx", ["vitest", "run", "test/unit"], serverDir);
  report.tests = vitest.ok;
  report.testCounts = vitestCounts(vitest.output);
  if (!vitest.ok) {
    const failing = vitest.output
      .split("\n")
      .filter((l) => /^\s*(×|✗|FAIL)\s/.test(l))
      .map((l) => l.trim());
    report.errors.push(
      `unit tests failed:\n${failing.length ? `${failing.join("\n")}\n---\n` : ""}${tail(vitest.output)}`,
    );
  }
  return finish();
}

const scratchRoot = resolve(process.env.SCHEMA_GRID_MATRIX_DIR ?? tmpdir());
if (!inPlace) mkdirSync(scratchRoot, { recursive: true });

const reports: VersionReport[] = [];
for (const version of versions) {
  const report = runVersion(version, scratchRoot);
  reports.push(report);
  if (!inPlace && !keep && report.dir !== REPO_ROOT) {
    rmSync(report.dir, { recursive: true, force: true });
  }
}

const mark = (v: boolean | null) =>
  v === null ? "skipped" : v ? "pass" : "FAIL";
const rows = [
  ["drizzle", "resolved", "typecheck", "unit tests", "counts", "time"],
  ...reports.map((r) => [
    r.version,
    r.resolved,
    r.install ? mark(r.typecheck) : "skipped",
    r.install ? mark(r.tests) : "skipped",
    r.testCounts,
    `${r.seconds.toFixed(1)}s`,
  ]),
];
const widths = rows[0].map((_, i) =>
  Math.max(...rows.map((row) => row[i].length)),
);
const line = (row: string[]) =>
  row.map((c, i) => c.padEnd(widths[i])).join("  ");

for (const r of reports) {
  for (const e of r.errors) console.error(`\n✗ drizzle-orm@${r.version}: ${e}`);
}
console.log("\nDrizzle peer-range matrix");
console.log(line(rows[0]));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows.slice(1)) console.log(line(row));
if (keep && !inPlace) {
  for (const r of reports) console.log(`kept: ${r.dir}`);
}

const failed = reports.some((r) => !r.install || !r.typecheck || !r.tests);
process.exit(failed ? 1 : 0);
