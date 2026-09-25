import { type RenderOptions, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

/**
 * Renders with a user-event instance. No provider is needed: every component
 * in this package is self-contained (tooltips self-provide Radix's provider).
 * `pointerEventsCheck: 0` because Radix sets `pointer-events: none` on <body>
 * while a modal layer is open, which jsdom cannot see through.
 */
export function renderUi(ui: ReactElement, options: RenderOptions = {}) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const result = render(ui, options);
  return { ...result, user };
}

export { userEvent };
