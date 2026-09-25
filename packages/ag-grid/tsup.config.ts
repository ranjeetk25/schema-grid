import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "editors/index": "src/editors/index.ts",
    "filters/index": "src/filters/index.ts",
    "sync/index": "src/sync/index.ts",
  },
  format: ["esm", "cjs"],
  // SCHEMA_GRID_AG_GRID_VERSION (src/index.ts) is the published package.json version.
  define: { __SCHEMA_GRID_AG_GRID_VERSION__: JSON.stringify(pkg.version) },
  dts: true,
  clean: true,
  sourcemap: true,
  tsconfig: "tsconfig.build.json",
  external: [
    "@ranjeetk25/schema-grid-core",
    "@ranjeetk25/schema-grid-io",
    "react",
    "react-dom",
    "ag-grid-community",
    "ag-grid-react",
  ],
});
