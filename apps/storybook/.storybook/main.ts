import type { StorybookConfig } from "@storybook/react-vite";
import { visualizer } from "rollup-plugin-visualizer";
import { defaultClientConditions, mergeConfig, type PluginOption } from "vite";

/**
 * `bun run analyze` sets ANALYZE=1: emit a treemap (bundle-stats.html) and the
 * raw per-module data (bundle-stats.json, read by scripts/report-chunks.ts)
 * next to the preview build in storybook-static/.
 */
function analyzePlugins(): PluginOption[] {
  if (!process.env.ANALYZE) return [];
  return [
    visualizer({ filename: "bundle-stats.html", emitFile: true, template: "treemap", gzipSize: true }),
    visualizer({ filename: "bundle-stats.json", emitFile: true, template: "raw-data", gzipSize: true }),
  ];
}

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  typescript: { reactDocgen: false },
  async viteFinal(base) {
    return mergeConfig(base, {
      // Workspace packages expose their TS source under the `development`
      // condition (no dist is built). Keep Vite's defaults after it.
      resolve: { conditions: ["development", ...defaultClientConditions] },
      // exceljs pulls a few Node built-ins lazily; nothing here needs them.
      optimizeDeps: { include: ["papaparse", "exceljs", "dayjs"] },
      plugins: analyzePlugins(),
      build: {
        chunkSizeWarningLimit: 4000,
        rollupOptions: {
          // Mantine ships "use client" directives; they are meaningless in a SPA bundle.
          onwarn(warning, warn) {
            if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
            warn(warning);
          },
        },
      },
    });
  },
};

export default config;
