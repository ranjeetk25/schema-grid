import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    "@masai/schema-grid-core",
    "@masai/schema-grid-ag-grid",
    "@masai/schema-grid-io",
    "react",
    "@mantine/core",
    "@mantine/hooks",
    "@mantine/dates",
    "dayjs",
  ],
});
