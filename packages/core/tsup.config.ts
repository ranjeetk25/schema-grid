import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "field-types/index": "src/field-types/index.ts",
    "formula/index": "src/formula/index.ts",
    "filter/index": "src/filter/index.ts",
    "memory/index": "src/memory/index.ts",
    "testing/index": "src/testing/index.ts",
    "wire/index": "src/wire/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["zod"],
});
