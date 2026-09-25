import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  // Same injection as tsup.config.ts so tests see the real package version.
  define: { __SCHEMA_GRID_UI_MANTINE_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    conditions: ["development"],
  },
  test: {
    name: "ui-mantine",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15000,
  },
});
