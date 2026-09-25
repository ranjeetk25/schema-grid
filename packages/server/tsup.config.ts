import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "drizzle/index": "src/drizzle/index.ts",
    "ddl/index": "src/ddl/index.ts",
    "http/index": "src/http/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@ranjeetk25/schema-grid-core", "drizzle-orm", "mysql2", "@ranjeetk25/schema-grid-io"],
});
