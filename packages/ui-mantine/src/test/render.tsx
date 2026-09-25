import { MantineProvider, type MantineProviderProps } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { type RenderOptions, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";

export interface RenderWithMantineOptions extends Omit<RenderOptions, "wrapper"> {
  /** "test" disables portals and transitions; "default" keeps them (portal tests). */
  env?: "test" | "default";
  theme?: MantineProviderProps["theme"];
  forceColorScheme?: MantineProviderProps["forceColorScheme"];
}

export function MantineTestWrapper({
  children,
  env = "test",
  theme,
  forceColorScheme,
}: {
  children: ReactNode;
  env?: "test" | "default";
  theme?: MantineProviderProps["theme"];
  forceColorScheme?: MantineProviderProps["forceColorScheme"];
}) {
  return (
    <MantineProvider env={env} theme={theme} forceColorScheme={forceColorScheme}>
      <DatesProvider settings={{ locale: "en" }}>{children}</DatesProvider>
    </MantineProvider>
  );
}

export function renderWithMantine(ui: ReactElement, options: RenderWithMantineOptions = {}) {
  const { env = "test", theme, forceColorScheme, ...rest } = options;
  const user = userEvent.setup();
  const result = render(ui, {
    ...rest,
    wrapper: ({ children }) => (
      <MantineTestWrapper env={env} theme={theme} forceColorScheme={forceColorScheme}>
        {children}
      </MantineTestWrapper>
    ),
  });
  return { ...result, user };
}

export { userEvent };
