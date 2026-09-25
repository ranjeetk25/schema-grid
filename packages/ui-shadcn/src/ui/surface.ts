import { cn } from "../lib/cn";

/**
 * The floating-layer surface shared by popovers, menus, select lists and
 * popup editor cards: opaque popover fill, 8px radius, hairline + soft
 * elevation, 140ms enter / 100ms exit.
 */
export const floatingSurface = cn(
  "sg:z-50 sg:rounded-lg sg:bg-popover sg:text-foreground sg:shadow-popover sg:outline-none",
  "sg:data-[state=open]:animate-in sg:data-[state=closed]:animate-out",
);
