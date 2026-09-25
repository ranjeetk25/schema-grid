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
