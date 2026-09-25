import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  // Same injection as tsup.config.ts so tests see the real package version.
  define: { __SCHEMA_GRID_AG_GRID_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    conditions: ["development"],
  },
  test: {
    name: "ag-grid",
    environment: "jsdom",
    setupFiles: ["../../vitest.setup.ts", "./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
  },
});
