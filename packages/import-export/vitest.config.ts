import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development", ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ["development", ...defaultServerConditions],
    },
  },
  test: {
    name: "import-export",
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
  },
});
