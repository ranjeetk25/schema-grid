import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { SG_PORTAL, cn } from "../lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<ElementRef<typeof TooltipPrimitive.Content>, ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(
  function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          data-slot="tooltip-content"
          sideOffset={sideOffset}
          className={cn(
            SG_PORTAL,
            "sg:z-50 sg:flex sg:max-w-72 sg:items-center sg:gap-1.5 sg:rounded-md sg:bg-foreground sg:px-2 sg:py-1 sg:text-xs sg:text-background",
            "sg:data-[state=delayed-open]:animate-in sg:data-[state=closed]:animate-out",
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Portal>
    );
  },
);

/**
 * One-liner tooltip. Self-provides a `TooltipProvider` so it works without a
 * host-level provider (Radix requires one).
 */
export function Tooltip({
  content,
  children,
  side = "top",
  delayDuration = 350,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}) {
  if (content == null || content === "") return <>{children}</>;
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={200}>
      <TooltipRoot>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{content}</TooltipContent>
      </TooltipRoot>
    </TooltipPrimitive.Provider>
  );
}
