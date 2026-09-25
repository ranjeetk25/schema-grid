import type { StorybookConfig } from "@storybook/react-vite";
import { defaultClientConditions, mergeConfig } from "vite";

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
