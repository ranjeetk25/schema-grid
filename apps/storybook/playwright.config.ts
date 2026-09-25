import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.STORYBOOK_E2E_PORT ?? 6007);
/** Point at an already running Storybook (e.g. `bun run storybook` on 6006) instead of the static build. */
const EXTERNAL_URL = process.env.STORYBOOK_URL;

/**
 * Runs against the static Storybook build (`storybook-static`), served by
 * `e2e/serve-static.ts`. Set `STORYBOOK_E2E_SKIP_BUILD=1` to reuse an existing
 * build, or `STORYBOOK_URL=http://localhost:6006` to test a running dev server. The demo-api spec skips itself when http://localhost:3001 is down.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [["list"]],
  use: {
    baseURL: EXTERNAL_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
  webServer: EXTERNAL_URL
    ? undefined
    : {
        command:
          process.env.STORYBOOK_E2E_SKIP_BUILD === "1"
            ? `bun e2e/serve-static.ts ${PORT}`
            : `bun run build-storybook && bun e2e/serve-static.ts ${PORT}`,
        url: `http://localhost:${PORT}/iframe.html`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: "ignore",
      },
});
