import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "../lib/cn";

export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <CheckboxPrimitive.Root
        ref={ref}
        data-slot="checkbox"
        className={cn(
          "sg:peer sg:grid sg:size-4 sg:shrink-0 sg:place-content-center sg:rounded-sm sg:border sg:border-input-hover sg:bg-background sg:shadow-xs",
          "sg:transition-colors sg:duration-100 sg:outline-none sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
          "sg:disabled:cursor-not-allowed sg:disabled:opacity-50",
          "sg:data-[state=checked]:border-primary sg:data-[state=checked]:bg-primary sg:data-[state=checked]:text-primary-foreground",
          "sg:data-[state=indeterminate]:border-primary sg:data-[state=indeterminate]:bg-primary sg:data-[state=indeterminate]:text-primary-foreground",
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="sg:grid sg:place-content-center">
          {props.checked === "indeterminate" ? (
            <MinusIcon className="sg:size-3" strokeWidth={3} />
          ) : (
            <CheckIcon className="sg:size-3" strokeWidth={3} />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
  },
);
