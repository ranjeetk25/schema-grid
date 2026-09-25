import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Manifest,
  publishManifestProblems,
  publishablePackages,
  REPO_ROOT,
  resolveWorkspaceSpecifier,
  toPublishManifest,
  workspaceVersions,
} from "./publish-manifest";
import { packAndInspect } from "./verify-pack";

const versions = new Map([
  ["@masai/a", "1.2.3"],
  ["@masai/b", "1.2.3"],
]);

describe("toPublishManifest", () => {
  it("drops every development condition and keeps the rest in order", () => {
    const out = toPublishManifest(
      {
        name: "@masai/a",
        version: "1.2.3",
        exports: {
          ".": {
            development: "./src/index.ts",
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
            require: "./dist/index.cjs",
          },
          "./nested": {
            import: { development: "./src/x.ts", default: "./dist/x.js" },
          },
          "./package.json": "./package.json",
        },
      },
      versions,
    );
    expect(out.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        require: "./dist/index.cjs",
      },
      "./nested": { import: { default: "./dist/x.js" } },
      "./package.json": "./package.json",
    });
    expect(
      Object.keys((out.exports as Record<string, object>)["."] ?? {})[0],
    ).toBe("types");
  });

  it("rewrites workspace: specifiers like pnpm/bun publish do", () => {
    expect(resolveWorkspaceSpecifier("@masai/a", "workspace:*", versions)).toBe(
      "1.2.3",
    );
    expect(resolveWorkspaceSpecifier("@masai/a", "workspace:^", versions)).toBe(
      "^1.2.3",
    );
    expect(resolveWorkspaceSpecifier("@masai/a", "workspace:~", versions)).toBe(
      "~1.2.3",
    );
    expect(
      resolveWorkspaceSpecifier("@masai/a", "workspace:^1.0.0", versions),
    ).toBe("^1.0.0");
    expect(resolveWorkspaceSpecifier("react", "^18.3.0", versions)).toBe(
      "^18.3.0",
    );
    expect(() =>
      resolveWorkspaceSpecifier("@masai/zzz", "workspace:*", versions),
    ).toThrow(/not a workspace/);

    const out = toPublishManifest(
      {
        name: "@masai/b",
        version: "1.2.3",
        dependencies: { "@masai/a": "workspace:*", zod: "^3.25.0" },
        peerDependencies: { "@masai/a": "*" },
        devDependencies: { "@masai/a": "workspace:*" },
      },
      versions,
    );
    expect(out.dependencies).toEqual({ "@masai/a": "1.2.3", zod: "^3.25.0" });
    expect(out.peerDependencies).toEqual({ "@masai/a": "*" });
    expect(out.devDependencies).toEqual({ "@masai/a": "1.2.3" });
  });
});

describe("repo packages", () => {
  const packages = publishablePackages(REPO_ROOT);
  const repoVersions = workspaceVersions(REPO_ROOT);

  it("finds the publishable packages", () => {
    expect(packages.map((p) => p.manifest.name)).toEqual(
      expect.arrayContaining([
        "@ranjeetk25/schema-grid-ag-grid",
        "@ranjeetk25/schema-grid-core",
        "@ranjeetk25/schema-grid-io",
        "@ranjeetk25/schema-grid-server",
        "@ranjeetk25/schema-grid-ui-mantine",
      ]),
    );
  });

  it.each(
    packages.map((p) => [p.manifest.name, p.manifest] as [string, Manifest]),
  )("%s is publish-ready after the transform", (_name, manifest) => {
    expect(
      publishManifestProblems(toPublishManifest(manifest, repoVersions)),
    ).toEqual([]);
  });

  it("the raw workspace manifests would NOT be publishable (the transform is load-bearing)", () => {
    const core = packages.find(
      (p) => p.manifest.name === "@ranjeetk25/schema-grid-core",
    );
    expect(
      publishManifestProblems(core?.manifest as Manifest).join("\n"),
    ).toMatch(/development/);
  });

  const coreDir = join(REPO_ROOT, "packages", "core");
  it.skipIf(!existsSync(join(coreDir, "dist")))(
    "the packed tarball's package.json has no development condition (needs a build)",
    () => {
      const report = packAndInspect(coreDir, repoVersions);
      expect(report.problems).toEqual([]);
      expect(JSON.stringify(report.manifest.exports)).not.toContain(
        "development",
      );
      expect(JSON.stringify(report.manifest.exports)).not.toContain("./src/");
      expect(
        report.files.every(
          (f) =>
            f.startsWith("dist/") ||
            ["package.json", "README.md", "LICENSE"].includes(f),
        ),
      ).toBe(true);
    },
    60_000,
  );
});
