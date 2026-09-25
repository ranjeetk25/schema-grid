import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const pkgRoot = join(__dirname, "..");
const FORBIDDEN = ["ag-grid", "enterprise"].join("-");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx|css|json|md)$/.test(name)) out.push(full);
  }
  return out;
}

describe("enterprise guard", () => {
  it("no source or test file references the enterprise package", () => {
    const offenders = [...walk(join(pkgRoot, "src")), ...walk(join(pkgRoot, "test"))]
      .filter((f) => !f.endsWith("noEnterprise.test.ts"))
      .filter((f) => readFileSync(f, "utf8").includes(FORBIDDEN))
      .map((f) => relative(pkgRoot, f));
    expect(offenders).toEqual([]);
  });

  it("package.json has no enterprise dependency", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as Record<string, unknown>;
    const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    for (const s of sections) {
      const deps = Object.keys((pkg[s] as Record<string, string> | undefined) ?? {});
      expect(deps.filter((d) => d.includes("enterprise"))).toEqual([]);
    }
  });
});
