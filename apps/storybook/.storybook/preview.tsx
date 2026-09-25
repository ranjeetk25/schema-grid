import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import {
  MantineProvider,
  localStorageColorSchemeManager,
  useMantineColorScheme,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import {
  mantineGridCssVariablesResolver,
  schemaGridMantineTheme,
} from "@ranjeetk25/schema-grid-ui-mantine";
import type { Decorator, Preview } from "@storybook/react";
import { type ReactNode, useEffect } from "react";

type ThemeGlobal = "light" | "dark";

const colorSchemeManager = localStorageColorSchemeManager({
  key: "mantine-color-scheme-value",
});

/** Follows the toolbar global; without one, the stored / default scheme stays. */
function SchemeSync({
  scheme,
  children,
}: {
  scheme: ThemeGlobal | undefined;
  children: ReactNode;
}) {
  const { setColorScheme } = useMantineColorScheme();
  useEffect(() => {
    if (scheme) setColorScheme(scheme);
  }, [scheme, setColorScheme]);
  return <>{children}</>;
}

const withMantine: Decorator = (Story, context) => {
  const scheme = context.globals.theme as ThemeGlobal | undefined;
  return (
    <MantineProvider
      theme={schemaGridMantineTheme}
      cssVariablesResolver={mantineGridCssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme={scheme ?? "light"}
    >
      <SchemeSync scheme={scheme}>
        <Notifications position="bottom-right" />
        <Story />
      </SchemeSync>
    </MantineProvider>
  );
};

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: false },
    actions: { argTypesRegex: undefined },
  },
  globalTypes: {
    theme: {
      description: "Mantine colour scheme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", icon: "sun", title: "Light" },
          { value: "dark", icon: "moon", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [withMantine],
};

export default preview;
