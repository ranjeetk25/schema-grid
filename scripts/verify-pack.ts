/**
 * Packs every publishable package exactly the way the release job will
 * (publish transform + `npm pack`), in a scratch copy, and inspects the
 * resulting tarball:
 *
 *   - only package.json, README.md, LICENSE and dist/** are inside
 *   - the packed package.json has no `development` condition and no
 *     `workspace:` specifier, and carries the publish metadata
 *   - every exports / main / module / types target exists in the tarball
 *
 * Needs `bun run build` first. Never touches the working tree.
 *
 *   bun scripts/verify-pack.ts
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  exportTargets,
  type Manifest,
  publishManifestProblems,
  publishablePackages,
  REPO_ROOT,
  toPublishManifest,
  workspaceVersions,
} from "./publish-manifest";

export interface PackReport {
  name: string;
  tarball: string;
  files: string[];
  manifest: Manifest;
  problems: string[];
}

const ALLOWED = (path: string) =>
  path === "package.json" ||
  path === "README.md" ||
  path === "LICENSE" ||
  path.startsWith("dist/");

export function packAndInspect(
  pkgDir: string,
  versions = workspaceVersions(REPO_ROOT),
): PackReport {
  const original = JSON.parse(
    readFileSync(join(pkgDir, "package.json"), "utf8"),
  ) as Manifest;
  const problems: string[] = [];
  if (!existsSync(join(pkgDir, "dist"))) {
    return {
      name: original.name,
      tarball: "",
      files: [],
      manifest: original,
      problems: [`${original.name}: no dist/ — run \`bun run build\` first`],
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), "schema-grid-pack-"));
  try {
    const copy = join(scratch, basename(pkgDir));
    // The whole package (src, test, configs…) so `files` filtering is really exercised.
    cpSync(pkgDir, copy, {
      recursive: true,
      filter: (src) => !src.split(/[\\/]/).includes("node_modules"),
    });
    writeFileSync(
      join(copy, "package.json"),
      `${JSON.stringify(toPublishManifest(original, versions), null, 2)}\n`,
    );
    copyFileSync(join(REPO_ROOT, "LICENSE"), join(copy, "LICENSE"));

    const out = join(scratch, "out");
    mkdirSync(out);
    const json = execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", out],
      {
        cwd: copy,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const [result] = JSON.parse(json) as Array<{
      filename: string;
      files: Array<{ path: string }>;
    }>;
    if (!result)
      throw new Error(`npm pack printed no result for ${original.name}`);
    const tarball = join(out, result.filename);
    const files = result.files.map((f) => f.path).sort();

    // Read package.json back out of the tarball itself, not from our copy.
    execFileSync("tar", ["-xzf", tarball, "-C", out, "package/package.json"]);
    const manifest = JSON.parse(
      readFileSync(join(out, "package", "package.json"), "utf8"),
    ) as Manifest;

    problems.push(...publishManifestProblems(manifest));
    for (const f of files) {
      if (!ALLOWED(f))
        problems.push(`${manifest.name}: unexpected file in tarball: ${f}`);
    }
    for (const required of ["package.json", "README.md", "LICENSE"]) {
      if (!files.includes(required))
        problems.push(`${manifest.name}: tarball is missing ${required}`);
    }
    const fileSet = new Set(files);
    for (const target of exportTargets(manifest)) {
      if (target === "package.json") continue;
      if (!fileSet.has(target))
        problems.push(
          `${manifest.name}: export target ${target} is not in the tarball`,
        );
    }
    return {
      name: manifest.name,
      tarball: result.filename,
      files,
      manifest,
      problems,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  let failed = false;
  for (const { dir } of publishablePackages(REPO_ROOT)) {
    const report = packAndInspect(dir);
    if (report.problems.length === 0) {
      console.log(
        `✓ ${report.name}: ${report.tarball} (${report.files.length} files)`,
      );
    } else {
      failed = true;
      for (const p of report.problems) console.error(`✗ ${p}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
