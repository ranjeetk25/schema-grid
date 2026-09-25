import { readFileSync } from "node:fs";
import { type Options, defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

/**
 * src/internal/icons.ts imports each Tabler icon from its own ESM module
 * (`@tabler/icons-react/dist/esm/icons/<Name>.mjs`); those files are ESM-only,
 * so the CJS build must not `require()` them. For `format: "cjs"` this swaps the
 * module for a re-export of the same names from the package's CJS barrel.
 */
const tablerIconsForCjs: EsbuildPlugin = {
  name: "tabler-icons-cjs",
  setup(build) {
    if (build.initialOptions.format !== "cjs") return;
    build.onLoad({ filter: /[\\/]src[\\/]internal[\\/]icons\.ts$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const names = [...src.matchAll(/^export const (Icon\w+)\b/gm)].map((m) => m[1]);
      return { contents: `export { ${names.join(", ")} } from "@tabler/icons-react";\n`, loader: "ts" };
    });
  },
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "editors/index": "src/editors/index.ts",
    "filter-builder/index": "src/filter-builder/index.ts",
    "column-builder/index": "src/column-builder/index.ts",
    "import-export/index": "src/import-export/index.ts",
  },
  format: ["esm", "cjs"],
  // SCHEMA_GRID_UI_MANTINE_VERSION (src/index.ts) is the published package.json version.
  define: { __SCHEMA_GRID_UI_MANTINE_VERSION__: JSON.stringify(pkg.version) },
  dts: true,
  clean: true,
  sourcemap: true,
  esbuildPlugins: [tablerIconsForCjs],
  external: [
    "@ranjeetk25/schema-grid-core",
    "@ranjeetk25/schema-grid-ag-grid",
    "@ranjeetk25/schema-grid-io",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@mantine/core",
    "@mantine/hooks",
    "@mantine/dates",
    "@mantine/notifications",
    "dayjs",
    "zod",
  ],
});
