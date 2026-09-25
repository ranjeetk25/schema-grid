import {
  type CSSVariablesResolver,
  type MantineColorsTuple,
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Input,
  InputWrapper,
  Kbd,
  Menu,
  Modal,
  Popover,
  SegmentedControl,
  Switch,
  Tooltip,
  createTheme,
  rem,
} from "@mantine/core";

/**
 * Design tokens (docs/design/README.md): zinc neutrals, one Linear-like
 * indigo accent, 13px base, 32px controls, 6px radii, soft popup elevation.
 */
export const SG_FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif';
export const SG_FONT_FAMILY_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Linear-like indigo; shade 6 (`#5e6ad2`) is the light-scheme accent. */
export const SG_BRAND: MantineColorsTuple = [
  "#eef0fb",
  "#dde0f6",
  "#bcc2ee",
  "#9aa3e5",
  "#7c86dc",
  "#6873d6",
  "#5e6ad2",
  "#4c57c0",
  "#414aa6",
  "#353d8a",
];

/** Zinc, light end first (Mantine `gray`). */
export const SG_ZINC: MantineColorsTuple = [
  "#fafafa",
  "#f4f4f5",
  "#e4e4e7",
  "#d4d4d8",
  "#a1a1aa",
  "#71717a",
  "#52525b",
  "#3f3f46",
  "#27272a",
  "#18181b",
];

/** Zinc for dark mode (Mantine `dark`: 0 = text, 4 = border, 6 = raised, 7 = body). */
export const SG_ZINC_DARK: MantineColorsTuple = [
  "#e4e4e7",
  "#c4c4cc",
  "#a1a1aa",
  "#71717a",
  "#2e2e33",
  "#26262b",
  "#1f1f23",
  "#18181b",
  "#111113",
  "#0b0b0d",
];

const POPUP_SHADOW_LIGHT = "0 8px 24px -6px rgb(0 0 0 / 0.12), 0 0 0 1px rgb(0 0 0 / 0.06)";
const POPUP_SHADOW_DARK = "0 12px 32px -8px rgb(0 0 0 / 0.6), 0 0 0 1px #2e2e33";

/** Control heights in px for the sizes we use (`sm` = 32 is the default). */
const CONTROL_HEIGHT: Record<string, number> = { xs: 28, sm: 32, md: 36 };
const CONTROL_FONT: Record<string, number> = { xs: 12, sm: 13, md: 14 };

function controlVars(size: unknown, heightVar: string, fontVar: string) {
  const key = typeof size === "string" ? size : "sm";
  const h = CONTROL_HEIGHT[key];
  const f = CONTROL_FONT[key];
  if (h === undefined || f === undefined) return {};
  return { [heightVar]: rem(h), [fontVar]: rem(f) };
}

/**
 * `createTheme` override for hosts: `<MantineProvider theme={schemaGridMantineTheme}
 * cssVariablesResolver={mantineGridCssVariablesResolver}>`, or
 * `mergeThemeOverrides(yourTheme, schemaGridMantineTheme)`.
 */
export const schemaGridMantineTheme = createTheme({
  fontFamily: SG_FONT_FAMILY,
  fontFamilyMonospace: SG_FONT_FAMILY_MONO,
  black: "#09090b",
  white: "#ffffff",
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 4 },
  colors: { brand: SG_BRAND, gray: SG_ZINC, dark: SG_ZINC_DARK },
  defaultRadius: "md",
  radius: { xs: rem(4), sm: rem(6), md: rem(6), lg: rem(8), xl: rem(12) },
  fontSizes: { xs: rem(12), sm: rem(13), md: rem(14), lg: rem(16), xl: rem(20) },
  spacing: { xs: rem(8), sm: rem(12), md: rem(16), lg: rem(24), xl: rem(32) },
  shadows: {
    xs: "0 1px 2px rgb(0 0 0 / 0.05)",
    sm: "0 1px 3px rgb(0 0 0 / 0.08), 0 0 0 1px rgb(0 0 0 / 0.04)",
    md: POPUP_SHADOW_LIGHT,
    lg: "0 16px 40px -12px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.06)",
    xl: "0 24px 64px -16px rgb(0 0 0 / 0.24), 0 0 0 1px rgb(0 0 0 / 0.06)",
  },
  headings: {
    fontWeight: "600",
    sizes: {
      h1: { fontSize: rem(24), lineHeight: "1.3" },
      h2: { fontSize: rem(20), lineHeight: "1.35" },
      h3: { fontSize: rem(16), lineHeight: "1.4" },
      h4: { fontSize: rem(14), lineHeight: "1.45" },
    },
  },
  cursorType: "pointer",
  focusRing: "auto",
  components: {
    Button: Button.extend({
      defaultProps: { size: "sm" },
      vars: (_theme, props) => {
        // Vercel rule: the primary (filled, uncoloured) button is monochrome —
        // zinc-900 on light, near-white on dark. The accent stays for focus,
        // selection and active states; an explicit `color` (e.g. red) wins.
        const monochrome = (props.variant === undefined || props.variant === "filled") && props.color === undefined;
        return {
          root: {
            ...controlVars(props.size, "--button-height", "--button-fz"),
            "--button-padding-x": props.size === "xs" ? rem(10) : rem(12),
            ...(monochrome
              ? {
                  "--button-bg": "var(--sg-cta-bg)",
                  "--button-hover": "var(--sg-cta-hover)",
                  "--button-color": "var(--sg-cta-fg)",
                }
              : {}),
          },
        };
      },
      styles: { root: { fontWeight: 500 } },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { variant: "subtle", color: "gray", size: "lg" },
      vars: (_theme, props) => {
        const px: Record<string, number> = { xs: 20, sm: 24, md: 28, lg: 32 };
        const v = px[typeof props.size === "string" ? props.size : "lg"];
        return { root: v ? { "--ai-size": rem(v) } : {} };
      },
    }),
    Input: Input.extend({
      vars: (_theme, props) => ({
        wrapper: controlVars(props.size, "--input-height", "--input-fz"),
      }),
    }),
    InputWrapper: InputWrapper.extend({
      styles: {
        label: { fontSize: rem(13), fontWeight: 500, marginBottom: rem(4) },
        description: { fontSize: rem(12), marginBottom: rem(6) },
        error: { fontSize: rem(12), marginTop: rem(4) },
      },
    }),
    Checkbox: Checkbox.extend({ defaultProps: { size: "xs", radius: "xs" } }),
    Switch: Switch.extend({ defaultProps: { size: "sm" } }),
    // Linear-style: transparent track, no item separators, the active item is a raised chip.
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { size: "xs", radius: "md", withItemsBorders: false },
      styles: {
        root: { backgroundColor: "transparent", padding: rem(2), gap: rem(2) },
        indicator: {
          backgroundColor: "var(--sg-segment-active-bg)",
          boxShadow: "0 0 0 1px var(--mantine-color-default-border), 0 1px 2px rgb(0 0 0 / 0.06)",
        },
        label: { fontSize: rem(12), fontWeight: 500, paddingInline: rem(10), paddingBlock: rem(5) },
      },
    }),
    Badge: Badge.extend({
      defaultProps: { variant: "light", radius: "sm", size: "sm" },
      styles: { root: { textTransform: "none", fontWeight: 500, letterSpacing: 0 } },
    }),
    Kbd: Kbd.extend({
      defaultProps: { size: "xs" },
      styles: { root: { fontSize: rem(11), padding: `0 ${rem(4)}`, borderBottomWidth: rem(1) } },
    }),
    Menu: Menu.extend({
      defaultProps: { shadow: "md", radius: "lg", transitionProps: { transition: "pop", duration: 120 } },
      styles: {
        dropdown: { padding: rem(4) },
        item: { fontSize: rem(13), minHeight: rem(30), padding: `${rem(6)} ${rem(8)}` },
        label: { fontSize: rem(11), fontWeight: 500 },
      },
    }),
    Popover: Popover.extend({
      defaultProps: { shadow: "md", radius: "lg", transitionProps: { transition: "pop", duration: 120 } },
    }),
    Tooltip: Tooltip.extend({
      defaultProps: { openDelay: 400, radius: "sm", withArrow: false, position: "bottom", offset: 6 },
      styles: {
        tooltip: {
          fontSize: rem(12),
          lineHeight: 1.4,
          padding: `${rem(4)} ${rem(8)}`,
          backgroundColor: "var(--sg-tooltip-bg)",
          color: "var(--sg-tooltip-fg)",
          boxShadow: "0 4px 12px -2px rgb(0 0 0 / 0.16)",
        },
      },
    }),
    Modal: Modal.extend({
      defaultProps: {
        radius: "xl",
        padding: "lg",
        shadow: "xl",
        overlayProps: { backgroundOpacity: 0.35, blur: 2 },
        transitionProps: { transition: "pop", duration: 160 },
      },
      styles: { title: { fontSize: rem(16), fontWeight: 600 } },
    }),
  },
});

/**
 * Colour-scheme variables that retune Mantine's own defaults to the zinc
 * tokens (hairline borders, muted text) and expose the popup shadow.
 * `mantineGridCssVariablesResolver` merges these in.
 */
export const schemaGridMantineVariables: ReturnType<CSSVariablesResolver> = {
  variables: {
    "--sg-popup-shadow-light": POPUP_SHADOW_LIGHT,
    "--sg-popup-shadow-dark": POPUP_SHADOW_DARK,
  },
  light: {
    "--sg-cta-bg": "#18181b",
    "--sg-cta-hover": "#27272a",
    "--sg-cta-fg": "#ffffff",
    "--sg-tooltip-bg": "#18181b",
    "--sg-tooltip-fg": "#fafafa",
    "--sg-segment-active-bg": "#ffffff",
    "--mantine-color-default-border": "#e4e4e7",
    "--mantine-color-default-hover": "#f4f4f5",
    "--mantine-color-dimmed": "#71717a",
    "--mantine-color-placeholder": "#a1a1aa",
    "--mantine-color-body": "#ffffff",
  },
  dark: {
    "--sg-cta-bg": "#fafafa",
    "--sg-cta-hover": "#e4e4e7",
    "--sg-cta-fg": "#09090b",
    "--sg-tooltip-bg": "#3f3f46",
    "--sg-tooltip-fg": "#fafafa",
    "--sg-segment-active-bg": "#2e2e33",
    "--mantine-color-default-border": "#2e2e33",
    "--mantine-color-default-hover": "#26262b",
    "--mantine-color-dimmed": "#a1a1aa",
    "--mantine-color-placeholder": "#71717a",
    "--mantine-color-body": "#18181b",
  },
};
