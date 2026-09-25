import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "editors/index": "src/editors/index.ts",
    "filters/index": "src/filters/index.ts",
    "sync/index": "src/sync/index.ts",
  },
  format: ["esm", "cjs"],
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
