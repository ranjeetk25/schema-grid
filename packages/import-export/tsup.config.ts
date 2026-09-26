import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Browser builds (`browser` export condition, v0.3.1): no `node:` specifier reachable.
    "index.browser": "src/index.browser.ts",
    "import/index": "src/import/index.ts",
    "export/index": "src/export/index.ts",
    "export/index.browser": "src/export/index.browser.ts",
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
