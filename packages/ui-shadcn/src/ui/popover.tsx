import * as PopoverPrimitive from "@radix-ui/react-popover";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { SG_PORTAL, cn } from "../lib/cn";
import { floatingSurface } from "./surface";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export type PopoverContentProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  /** Render into a portal on <body> (default). `false` renders in place — use inside AG Grid popups. */
  portalled?: boolean;
  container?: HTMLElement | null;
};

export const PopoverContent = forwardRef<ElementRef<typeof PopoverPrimitive.Content>, PopoverContentProps>(function PopoverContent(
  { className, align = "start", sideOffset = 6, portalled = true, container, ...props },
  ref,
) {
  const content = (
    <PopoverPrimitive.Content
      ref={ref}
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(SG_PORTAL, floatingSurface, "sg:w-72 sg:p-3", "sg:origin-[var(--radix-popover-content-transform-origin)]", className)}
      {...props}
    />
  );
  return portalled ? <PopoverPrimitive.Portal container={container}>{content}</PopoverPrimitive.Portal> : content;
});
