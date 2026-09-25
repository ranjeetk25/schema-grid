import * as SwitchPrimitive from "@radix-ui/react-switch";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "../lib/cn";

export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  function Switch({ className, ...props }, ref) {
    return (
      <SwitchPrimitive.Root
        ref={ref}
        data-slot="switch"
        className={cn(
          "sg:peer sg:inline-flex sg:h-[18px] sg:w-8 sg:shrink-0 sg:items-center sg:rounded-full sg:border sg:border-transparent sg:shadow-xs",
          "sg:transition-colors sg:duration-150 sg:outline-none sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
          "sg:disabled:cursor-not-allowed sg:disabled:opacity-50 sg:data-[state=checked]:bg-primary sg:data-[state=unchecked]:bg-input-hover",
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "sg:pointer-events-none sg:block sg:size-3.5 sg:rounded-full sg:bg-white sg:shadow-sm sg:ring-0 sg:transition-transform sg:duration-150",
            "sg:data-[state=checked]:translate-x-[15px] sg:data-[state=unchecked]:translate-x-px",
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);
