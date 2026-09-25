/**
 * CSS build (after tsup):
 * - dist/styles.css  — prebuilt, minified Tailwind v4 output (prefixed `sg:`),
 *                      for hosts that don't run Tailwind.
 * - dist/tailwind.css + dist/styles/tokens.css — the source entry for hosts
 *                      that run Tailwind v4; its `@source "./"` scans dist.
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
mkdirSync(join(dist, "styles"), { recursive: true });

const proc = Bun.spawnSync(
  ["bunx", "@tailwindcss/cli", "-i", "src/tailwind.css", "-o", "dist/styles.css", "--minify"],
  { cwd: root, stdout: "inherit", stderr: "pipe" },
);
if (proc.exitCode !== 0) {
  process.stderr.write(proc.stderr);
  process.exit(proc.exitCode ?? 1);
}

copyFileSync(join(root, "src/tailwind.css"), join(dist, "tailwind.css"));
copyFileSync(join(root, "src/styles/tokens.css"), join(dist, "styles/tokens.css"));

const kb = (f: string) => `${(statSync(join(dist, f)).size / 1024).toFixed(1)} kB`;
console.log(`styles.css ${kb("styles.css")}`);
