import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    "@masai/schema-grid-core",
    "react",
    "ag-grid-community",
    "ag-grid-react",
  ],
});
