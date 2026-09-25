/**
 * Publish-time package.json transform, shared by `prepare-publish.ts`,
 * `verify-pack.ts` and the unit tests.
 *
 * In the repo, every `exports` entry carries a `development` condition that
 * points at `./src/*.ts`, so the workspace (Storybook, demo-api, vitest) runs
 * straight from source. `src` is not in `files`, and Vite and webpack both
 * enable the `development` condition in dev mode — shipped as-is, every
 * consumer's dev server would try to load a file that is not in the tarball.
 * Workspace dependencies are also declared as `workspace:*`, which the npm CLI
 * (the publisher `changeset publish` drives) does not rewrite.
 *
 * `toPublishManifest` fixes both: it drops every `development` condition and
 * replaces `workspace:` specifiers with the real versions.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Manifest = Record<string, unknown> & {
  name: string;
  version: string;
  private?: boolean;
};

export const DEV_CONDITION = "development";

const DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
] as const;

export const REPO_URL = "git+https://github.com/ranjeetk25/schema-grid.git";

export interface WorkspacePackage {
  dir: string;
  manifest: Manifest;
}

/** Every workspace package under `packages/*` (private or not). */
export function readWorkspacePackages(root: string): WorkspacePackage[] {
  const base = join(root, "packages");
  return readdirSync(base, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && existsSync(join(base, d.name, "package.json")),
    )
    .map((d) => {
      const dir = join(base, d.name);
      const manifest = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as Manifest;
      return { dir, manifest };
    })
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export function publishablePackages(root: string): WorkspacePackage[] {
  return readWorkspacePackages(root).filter((p) => p.manifest.private !== true);
}

/** name -> version for every workspace package (the targets of `workspace:`). */
export function workspaceVersions(root: string): Map<string, string> {
  return new Map(
    readWorkspacePackages(root).map((p) => [
      p.manifest.name,
      p.manifest.version,
    ]),
  );
}

function stripCondition(value: unknown, condition: string): unknown {
  if (Array.isArray(value))
    return value.map((v) => stripCondition(v, condition));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === condition) continue;
    out[key] = stripCondition(inner, condition);
  }
  return out;
}

/** Same semantics as pnpm / bun publish. */
export function resolveWorkspaceSpecifier(
  name: string,
  spec: string,
  versions: Map<string, string>,
): string {
  if (!spec.startsWith("workspace:")) return spec;
  const range = spec.slice("workspace:".length);
  const version = versions.get(name);
  if (version === undefined) {
    throw new Error(`"${name}" uses ${spec} but is not a workspace package`);
  }
  if (range === "*" || range === "") return version;
  if (range === "^") return `^${version}`;
  if (range === "~") return `~${version}`;
  return range;
}

export function toPublishManifest(
  manifest: Manifest,
  versions: Map<string, string>,
): Manifest {
  const out: Manifest = { ...manifest };
  if (out.exports !== undefined)
    out.exports = stripCondition(out.exports, DEV_CONDITION);
  for (const field of DEP_FIELDS) {
    const deps = out[field] as Record<string, string> | undefined;
    if (!deps) continue;
    out[field] = Object.fromEntries(
      Object.entries(deps).map(([name, spec]) => [
        name,
        resolveWorkspaceSpecifier(name, spec, versions),
      ]),
    );
  }
  return out;
}

function hasCondition(value: unknown, condition: string): boolean {
  if (Array.isArray(value))
    return value.some((v) => hasCondition(v, condition));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([k, v]) => k === condition || hasCondition(v, condition),
  );
}

/** Every file path an `exports` map (or main/module/types) points at. */
export function exportTargets(manifest: Manifest): string[] {
  const targets = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") targets.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      Object.values(value).forEach(walk);
  };
  walk(manifest.exports);
  for (const field of ["main", "module", "types"]) {
    if (typeof manifest[field] === "string")
      targets.add(manifest[field] as string);
  }
  return [...targets].map((t) => t.replace(/^\.\//, ""));
}

/**
 * What would be wrong with publishing `manifest` exactly as given. Empty means
 * ready. Run on the OUTPUT of `toPublishManifest`.
 */
export function publishManifestProblems(manifest: Manifest): string[] {
  const problems: string[] = [];
  const name = manifest.name;
  if (manifest.private === true) problems.push(`${name}: is private`);
  if (hasCondition(manifest.exports, DEV_CONDITION)) {
    problems.push(
      `${name}: exports still carry a "${DEV_CONDITION}" condition`,
    );
  }
  for (const field of DEP_FIELDS) {
    const deps = (manifest[field] ?? {}) as Record<string, string>;
    for (const [dep, spec] of Object.entries(deps)) {
      if (spec.startsWith("workspace:"))
        problems.push(`${name}: ${field}.${dep} is "${spec}"`);
    }
  }
  for (const target of exportTargets(manifest)) {
    if (target.startsWith("src/"))
      problems.push(`${name}: export target "${target}" points into src/`);
  }
  if (manifest.license !== "MIT")
    problems.push(`${name}: license is not "MIT"`);
  const repo = manifest.repository as
    | { url?: string; directory?: string }
    | undefined;
  if (repo?.url !== REPO_URL)
    problems.push(`${name}: repository.url is not ${REPO_URL}`);
  if (!repo?.directory)
    problems.push(`${name}: repository.directory is missing`);
  if (typeof manifest.homepage !== "string")
    problems.push(`${name}: homepage is missing`);
  const bugs = manifest.bugs as { url?: string } | undefined;
  if (!bugs?.url) problems.push(`${name}: bugs.url is missing`);
  const publishConfig = manifest.publishConfig as
    | { access?: string; provenance?: boolean }
    | undefined;
  if (publishConfig?.access !== "public")
    problems.push(`${name}: publishConfig.access is not "public"`);
  if (publishConfig?.provenance !== true)
    problems.push(`${name}: publishConfig.provenance is not true`);
  const files = manifest.files as string[] | undefined;
  if (!files?.includes("dist"))
    problems.push(`${name}: files does not include "dist"`);
  const engines = manifest.engines as { node?: string } | undefined;
  if (!engines?.node) problems.push(`${name}: engines.node is missing`);
  return problems;
}

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
