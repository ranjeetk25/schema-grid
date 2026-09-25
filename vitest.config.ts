import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/server",
      "packages/ag-grid",
      "packages/ui-mantine",
      "packages/import-export",
    ],
  },
});
