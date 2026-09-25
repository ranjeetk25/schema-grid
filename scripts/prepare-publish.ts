/**
 * Rewrites every publishable package's package.json into its npm form (see
 * `publish-manifest.ts`) right before `changeset publish` runs.
 *
 *   bun scripts/prepare-publish.ts           # dry run: print what would change
 *   bun scripts/prepare-publish.ts --write   # rewrite in place + copy LICENSE (CI only)
 *   bun scripts/prepare-publish.ts --check   # exit 1 unless every manifest on disk is publish-ready
 *
 * The rewrite happens IN PLACE, before `npm publish` reads the manifest, so the
 * tarball AND the registry metadata (which npm installs resolve against) both
 * get the clean form. It is not reverted: the release job's checkout is thrown
 * away. Locally `--write` refuses to run without `--force`; afterwards
 * `git checkout -- packages/*\/package.json` restores the workspace form.
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  publishManifestProblems,
  publishablePackages,
  REPO_ROOT,
  toPublishManifest,
  workspaceVersions,
} from "./publish-manifest";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const check = args.has("--check");

const packages = publishablePackages(REPO_ROOT);
const versions = workspaceVersions(REPO_ROOT);
let failed = false;

if (check) {
  for (const { manifest } of packages) {
    const problems = publishManifestProblems(manifest);
    for (const p of problems) console.error(`✗ ${p}`);
    if (problems.length === 0)
      console.log(`✓ ${manifest.name}@${manifest.version} is publish-ready`);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
}

if (write && !process.env.CI && !args.has("--force")) {
  console.error(
    "prepare-publish --write rewrites tracked package.json files. It is meant for the release job.\n" +
      "Pass --force to run it locally, then `git checkout -- packages/*/package.json` to undo.",
  );
  process.exit(1);
}

for (const { dir, manifest } of packages) {
  const next = toPublishManifest(manifest, versions);
  const problems = publishManifestProblems(next);
  for (const p of problems) console.error(`✗ ${p}`);
  failed ||= problems.length > 0;

  const before = JSON.stringify(manifest, null, 2);
  const after = JSON.stringify(next, null, 2);
  console.log(
    `${before === after ? "=" : "~"} ${manifest.name}@${manifest.version}`,
  );

  if (write && problems.length === 0) {
    writeFileSync(join(dir, "package.json"), `${after}\n`);
    // npm always packs a LICENSE file sitting next to package.json.
    copyFileSync(join(REPO_ROOT, "LICENSE"), join(dir, "LICENSE"));
  }
}

if (failed) process.exit(1);
if (!write) console.log("\nDry run. Pass --write to apply.");
