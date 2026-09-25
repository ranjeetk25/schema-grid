import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "import/index": "src/import/index.ts",
    "export/index": "src/export/index.ts",
    "clipboard/index": "src/clipboard/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  external: [
    "@ranjeetk25/schema-grid-core",
    "papaparse",
    "exceljs",
    "node:stream",
  ],
});
