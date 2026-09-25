import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { defaultClientConditions, mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  typescript: { reactDocgen: false },
  async viteFinal(base) {
    return mergeConfig(base, {
      // The kit is consumed through its Tailwind v4 source entry (the
      // "host runs Tailwind" path); `tailwind.css` scans the kit's src.
      plugins: [tailwindcss()],
      // Workspace packages expose their TS source under the `development`
      // condition (no dist is built). Keep Vite's defaults after it.
      resolve: { conditions: ["development", ...defaultClientConditions] },
      optimizeDeps: { include: ["papaparse", "exceljs"] },
      build: {
        chunkSizeWarningLimit: 4000,
        rollupOptions: {
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
