import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "drizzle/index": "src/drizzle/index.ts",
    "ddl/index": "src/ddl/index.ts",
    "http/index": "src/http/index.ts",
  },
  format: ["esm", "cjs"],
  // SCHEMA_GRID_SERVER_VERSION (src/index.ts) is the published package.json version.
  define: { __SCHEMA_GRID_SERVER_VERSION__: JSON.stringify(pkg.version) },
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@ranjeetk25/schema-grid-core", "drizzle-orm", "mysql2", "@ranjeetk25/schema-grid-io"],
});
