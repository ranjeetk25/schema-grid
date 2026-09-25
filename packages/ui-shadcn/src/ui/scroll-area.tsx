import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

export function ScrollArea({ className, children, ...props }: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn("sg:relative sg:overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="sg:size-full sg:rounded-[inherit] sg:outline-none sg:[&>div]:!block">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({ className, orientation = "vertical", ...props }: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        "sg:flex sg:touch-none sg:p-px sg:transition-colors sg:select-none",
        orientation === "vertical" ? "sg:h-full sg:w-2" : "sg:h-2 sg:flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="sg:relative sg:flex-1 sg:rounded-full sg:bg-input-hover" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
