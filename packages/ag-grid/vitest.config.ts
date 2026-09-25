import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development"],
  },
  test: {
    name: "ag-grid",
    environment: "jsdom",
    setupFiles: ["../../vitest.setup.ts"],
  },
});
