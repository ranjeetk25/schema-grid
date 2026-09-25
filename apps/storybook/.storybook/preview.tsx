import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { mantineGridCssVariablesResolver } from "@ranjeetk25/schema-grid-ui-mantine";
import type { Preview } from "@storybook/react";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: false },
    actions: { argTypesRegex: undefined },
  },
  decorators: [
    (Story) => (
      <MantineProvider
        cssVariablesResolver={mantineGridCssVariablesResolver}
        defaultColorScheme="light"
      >
        <Notifications position="bottom-right" />
        <div style={{ padding: 16 }}>
          <Story />
        </div>
      </MantineProvider>
    ),
  ],
};

export default preview;
