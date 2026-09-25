import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "drizzle/index": "src/drizzle/index.ts",
    "ddl/index": "src/ddl/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@masai/schema-grid-core", "drizzle-orm", "mysql2", "@masai/schema-grid-io"],
});
