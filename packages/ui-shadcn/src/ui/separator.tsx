import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

export function Separator({ className, orientation = "horizontal", decorative = true, ...props }: ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "sg:shrink-0 sg:bg-border",
        orientation === "horizontal" ? "sg:h-px sg:w-full" : "sg:h-full sg:w-px",
        className,
      )}
      {...props}
    />
  );
}
