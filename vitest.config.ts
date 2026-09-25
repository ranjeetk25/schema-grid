import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/server",
      "packages/ag-grid",
      "packages/ui-mantine",
      "packages/ui-shadcn",
      "packages/import-export",
      "apps/demo-api",
      // Release tooling: publish-manifest transform + packed-tarball checks.
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
