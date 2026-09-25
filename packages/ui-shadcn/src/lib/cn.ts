import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Every Tailwind utility in this package is written with the `sg:` prefix
 * (Tailwind v4 `prefix(sg)`), so our prebuilt CSS never collides with a
 * host's own Tailwind build. tailwind-merge must know the prefix to dedupe.
 */
const twMerge = extendTailwindMerge({
  prefix: "sg",
  extend: {
    theme: {
      text: ["2xs"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Root class for everything this package renders — including Radix portal
 * content, which lands on `document.body` outside the host's tree. Scopes the
 * mini-preflight and base type (13px, font stack, tabular numerals) and marks
 * the node for AG Grid (`ag-custom-component-popup`) so a click in a portalled
 * dropdown opened from a grid filter / popup editor is not an outside click.
 */
export const SG_ROOT = "sg-ui";
export const SG_PORTAL = "sg-ui ag-custom-component-popup";
