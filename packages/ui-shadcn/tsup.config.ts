import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "editors/index": "src/editors/index.ts",
    "filter-builder/index": "src/filter-builder/index.ts",
    "column-builder/index": "src/column-builder/index.ts",
    "import-export/index": "src/import-export/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Everything in dependencies/peerDependencies is external by default; listed
  // explicitly for the ones reached through subpaths.
  external: [
    "@ranjeetk25/schema-grid-core",
    "@ranjeetk25/schema-grid-ag-grid",
    "@ranjeetk25/schema-grid-io",
    "ag-grid-community",
    "ag-grid-react",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "sonner",
    "zod",
  ],
});
