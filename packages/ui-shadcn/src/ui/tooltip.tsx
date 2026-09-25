import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { SG_PORTAL, cn } from "../lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<ElementRef<typeof TooltipPrimitive.Content>, ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(
  function TooltipContent({ className, sideOffset = 6, side = "bottom", ...props }, ref) {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          data-slot="tooltip-content"
          sideOffset={sideOffset}
          side={side}
          className={cn(
            SG_PORTAL,
            "sg:z-50 sg:flex sg:max-w-72 sg:items-center sg:gap-2 sg:rounded-md sg:bg-zinc-900 sg:px-2 sg:py-1 sg:text-xs sg:text-zinc-50 sg:shadow-popover sg:dark:ring-1 sg:dark:ring-white/10",
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
 * One-liner tooltip (Linear/Vercel style): zinc-900, 12px, radius 6, below the
 * control, 400ms open delay, an optional `shortcut` shown as ONE muted mono
 * string ("⌘⇧Z"). Self-provides a `TooltipProvider` so it works without a
 * host-level provider (Radix requires one).
 */
export function Tooltip({
  content,
  shortcut,
  children,
  side = "bottom",
  delayDuration = 400,
}: {
  content: ReactNode;
  /** Keyboard shortcut as one string, e.g. "⌘⇧Z". */
  shortcut?: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}) {
  if (content == null || content === "") return <>{children}</>;
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={200}>
      <TooltipRoot>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>
          <span>{content}</span>
          {shortcut ? <span className="sg:font-mono sg:text-2xs sg:tracking-wide sg:text-zinc-400">{shortcut}</span> : null}
        </TooltipContent>
      </TooltipRoot>
    </TooltipPrimitive.Provider>
  );
}
