import * as LabelPrimitive from "@radix-ui/react-label";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "../lib/cn";

export const Label = forwardRef<ElementRef<typeof LabelPrimitive.Root>, ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(
  function Label({ className, ...props }, ref) {
    return (
      <LabelPrimitive.Root
        ref={ref}
        data-slot="label"
        className={cn(
          "sg:flex sg:items-center sg:gap-1 sg:text-sm sg:font-medium sg:leading-5 sg:text-foreground sg:select-none",
          "sg:peer-disabled:cursor-not-allowed sg:peer-disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
