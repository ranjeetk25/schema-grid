import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  // Same injection as tsup.config.ts so tests see the real package version.
  define: { __SCHEMA_GRID_SERVER_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    conditions: ["development"],
  },
  test: {
    name: "server",
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 120_000,
  },
});
