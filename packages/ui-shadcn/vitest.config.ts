import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development"],
  },
  test: {
    name: "ui-shadcn",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15000,
  },
});
