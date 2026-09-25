import "./preview.css";
import type { Decorator, Preview } from "@storybook/react";
import { useEffect } from "react";
import { Toaster } from "sonner";

/** Toolbar light/dark toggle: `.dark` on <html>, the shadcn convention the kit's tokens key off. */
const withScheme: Decorator = (Story, context) => {
  const scheme = context.globals.scheme === "dark" ? "dark" : "light";
  useEffect(() => {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    document.documentElement.style.colorScheme = scheme;
  }, [scheme]);
  return (
    <div className="sg-ui sg:min-h-screen sg:bg-background sg:p-4">
      <Toaster position="bottom-right" theme={scheme} />
      <Story />
    </div>
  );
};

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: false },
    actions: { argTypesRegex: undefined },
  },
  globalTypes: {
    scheme: {
      description: "Colour scheme",
      toolbar: {
        title: "Scheme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: "light" },
  decorators: [withScheme],
};

export default preview;
