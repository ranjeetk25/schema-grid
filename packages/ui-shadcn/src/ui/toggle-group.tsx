import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "../lib/cn";

/** Segmented control (e.g. AND / OR). */
export const ToggleGroup = forwardRef<ElementRef<typeof ToggleGroupPrimitive.Root>, ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>>(
  function ToggleGroup({ className, ...props }, ref) {
    return (
      <ToggleGroupPrimitive.Root
        ref={ref}
        className={cn("sg:inline-flex sg:h-7 sg:items-center sg:rounded-md sg:bg-muted sg:p-0.5", className)}
        {...props}
      />
    );
  },
);

export const ToggleGroupItem = forwardRef<
  ElementRef<typeof ToggleGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(function ToggleGroupItem({ className, ...props }, ref) {
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        "sg:inline-flex sg:h-6 sg:min-w-9 sg:items-center sg:justify-center sg:rounded-[5px] sg:px-2 sg:text-xs sg:font-medium sg:text-muted-foreground",
        "sg:transition-colors sg:outline-none sg:hover:text-foreground sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
        "sg:data-[state=on]:bg-background sg:data-[state=on]:text-foreground sg:data-[state=on]:shadow-xs sg:disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
