/**
 * Fallback if the `masai` npm org cannot be used: renames every
 * `@masai/schema-grid…` reference in git-tracked text files to another scope.
 *
 *   bun scripts/rename-scope.ts --to @acme                # dry run (default): list files + counts
 *   bun scripts/rename-scope.ts --to @acme --write        # apply
 *   bun scripts/rename-scope.ts --from @masai --to @acme  # --from defaults to @masai
 *
 * Only the `<from>/schema-grid` prefix is rewritten, so an unrelated
 * `@masai/<something-else>` dependency would be left alone. Only tracked files
 * are touched (node_modules, dist and untracked files are never read);
 * binary files are skipped. After --write: `bun install` (refreshes
 * bun.lock), `bun run typecheck && bun run test && bun run build`, review
 * `git diff`, commit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./publish-manifest";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const SCOPE = /^@[a-z0-9][a-z0-9-._]*$/;
const from = arg("--from") ?? "@masai";
const to = arg("--to");
const write = process.argv.includes("--write");

if (!to || !SCOPE.test(to) || !SCOPE.test(from)) {
  console.error(
    "Usage: bun scripts/rename-scope.ts --to @newscope [--from @masai] [--write]",
  );
  console.error("Scopes are lowercase, start with @, e.g. @masai-school.");
  process.exit(1);
}
if (to === from) {
  console.error("--to is the same as --from; nothing to do.");
  process.exit(1);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// `@masai/schema-grid` as a whole token: `@masai/schema-grid-core`, `…/schema-grid-*`, prose mentions.
const pattern = new RegExp(
  `(?<![\\w.-])${escapeRegExp(from)}/schema-grid(?!\\w)`,
  "g",
);
const replacement = `${to}/schema-grid`;

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .filter((f) => f !== "scripts/rename-scope.ts");

let totalFiles = 0;
let totalHits = 0;
for (const file of tracked) {
  const path = join(REPO_ROOT, file);
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    continue; // deleted in the working tree
  }
  if (buf.includes(0)) continue; // binary
  const text = buf.toString("utf8");
  const hits = text.match(pattern)?.length ?? 0;
  if (hits === 0) continue;
  totalFiles += 1;
  totalHits += hits;
  console.log(`${String(hits).padStart(5)}  ${file}`);
  if (write) writeFileSync(path, text.replace(pattern, replacement));
}

console.log(
  `\n${totalHits} reference(s) in ${totalFiles} file(s): ${from}/schema-grid* -> ${to}/schema-grid*`,
);
if (!write) console.log("Dry run. Re-run with --write to apply.");
else
  console.log(
    "Done. Now: bun install && bun run typecheck && bun run test && bun run build",
  );
