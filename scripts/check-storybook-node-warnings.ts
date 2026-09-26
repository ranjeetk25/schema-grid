/**
 * Builds both Storybooks and fails if either build mentions a Node built-in
 * on the browser path. Storybook resolves workspace packages from source via
 * the `development` condition with Vite's client conditions, so the nested
 * `development: { browser, default }` mapping in
 * `packages/import-export/package.json` is what routes it to
 * `src/index.browser.ts`; if that regresses, Vite prints
 * "Module "node:stream" has been externalized for browser compatibility".
 *
 *   bun scripts/check-storybook-node-warnings.ts
 *
 * Output of each build is captured to OUT_DIR (default: a temp directory, or
 * $STORYBOOK_CHECK_OUT) and the paths are printed. After the builds, the
 * emitted `storybook-static/assets/*.js` are grepped for `node:stream` too.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WARNING = /node:stream|externalized for browser compatibility/;
const ASSET_HIT = /["']node:stream["']/;

const outDir = process.env.STORYBOOK_CHECK_OUT ?? mkdtempSync(join(tmpdir(), "storybook-node-check-"));
mkdirSync(outDir, { recursive: true });

const BUILDS: Array<{ script: string; staticDir: string; log: string }> = [
  { script: "build-storybook", staticDir: "apps/storybook/storybook-static", log: "build-storybook.log" },
  {
    script: "build-storybook:shadcn",
    staticDir: "apps/storybook-shadcn/storybook-static",
    log: "build-storybook-shadcn.log",
  },
];

let failed = false;

for (const { script, staticDir, log } of BUILDS) {
  console.log(`\n▶ bun run ${script}`);
  const result = spawnSync("bun", ["run", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const logPath = join(outDir, log);
  writeFileSync(logPath, output);
  console.log(`  log: ${logPath}`);

  if (result.status !== 0) {
    failed = true;
    console.error(`✗ ${script} exited with ${result.status}`);
  }
  const warnLines = output.split("\n").filter((l) => WARNING.test(l));
  if (warnLines.length > 0) {
    failed = true;
    console.error(`✗ ${script}: build output mentions a Node built-in:`);
    for (const l of warnLines.slice(0, 10)) console.error(`    ${l.trim()}`);
  } else {
    console.log(`✓ ${script}: no node:stream / externalized warning in build output`);
  }

  const assets = join(REPO_ROOT, staticDir, "assets");
  if (existsSync(assets)) {
    const hits = readdirSync(assets)
      .filter((f) => f.endsWith(".js"))
      .filter((f) => ASSET_HIT.test(readFileSync(join(assets, f), "utf8")));
    if (hits.length > 0) {
      failed = true;
      console.error(`✗ ${staticDir}/assets: node:stream in ${hits.join(", ")}`);
    } else {
      console.log(`✓ ${staticDir}/assets: no node:stream in emitted JS`);
    }
  } else {
    console.log(`  (no ${staticDir}/assets to grep)`);
  }
}

process.exit(failed ? 1 : 0);
