import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { SG_PORTAL, cn } from "../lib/cn";
import { floatingSurface } from "./surface";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { size?: "sm" | "md" }
>(function SelectTrigger({ className, children, size = "md", ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      data-slot="select-trigger"
      className={cn(
        "sg:flex sg:w-full sg:items-center sg:justify-between sg:gap-1.5 sg:rounded-md sg:border sg:border-input sg:bg-background sg:px-2.5 sg:text-sm sg:whitespace-nowrap sg:shadow-xs",
        "sg:transition-[border-color,box-shadow] sg:duration-150 sg:outline-none sg:hover:border-input-hover",
        "sg:focus-visible:border-primary sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
        "sg:disabled:cursor-not-allowed sg:disabled:opacity-50 sg:data-[placeholder]:text-faint-foreground sg:aria-invalid:border-danger",
        "sg:*:data-[slot=select-value]:truncate sg:*:data-[slot=select-value]:flex sg:*:data-[slot=select-value]:items-center sg:*:data-[slot=select-value]:gap-1.5",
        size === "sm" ? "sg:h-7" : "sg:h-8",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="sg:size-3.5 sg:text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & { portalled?: boolean }
>(function SelectContent({ className, children, position = "popper", portalled = true, ...props }, ref) {
  const content = (
    <SelectPrimitive.Content
      ref={ref}
      data-slot="select-content"
      position={position}
      sideOffset={4}
      collisionPadding={8}
      className={cn(
        SG_PORTAL,
        floatingSurface,
        "sg:relative sg:max-h-[min(var(--radix-select-content-available-height),320px)] sg:min-w-32 sg:overflow-hidden",
        position === "popper" && "sg:w-full sg:min-w-[var(--radix-select-trigger-width)]",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="sg:p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  );
  return portalled ? <SelectPrimitive.Portal>{content}</SelectPrimitive.Portal> : content;
});

export const SelectItem = forwardRef<ElementRef<typeof SelectPrimitive.Item>, ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  function SelectItem({ className, children, ...props }, ref) {
    return (
      <SelectPrimitive.Item
        ref={ref}
        data-slot="select-item"
        className={cn(
          "sg:relative sg:flex sg:h-[30px] sg:w-full sg:cursor-default sg:items-center sg:gap-2 sg:rounded-md sg:pr-8 sg:pl-2 sg:text-sm sg:outline-none sg:select-none",
          "sg:data-[highlighted]:bg-muted sg:data-[disabled]:pointer-events-none sg:data-[disabled]:opacity-50",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <span className="sg:absolute sg:right-2 sg:flex sg:size-4 sg:items-center sg:justify-center">
          <SelectPrimitive.ItemIndicator>
            <CheckIcon className="sg:size-4 sg:text-primary" />
          </SelectPrimitive.ItemIndicator>
        </span>
      </SelectPrimitive.Item>
    );
  },
);

export function SelectSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("sg:-mx-1 sg:my-1 sg:h-px sg:bg-border", className)} {...props} />;
}

export function SelectLabel({ className, ...props }: ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn("sg:px-2 sg:py-1 sg:text-xs sg:text-muted-foreground", className)} {...props} />;
}
