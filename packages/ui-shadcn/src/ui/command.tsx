import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "../lib/cn";

export const Command = forwardRef<ElementRef<typeof CommandPrimitive>, ComponentPropsWithoutRef<typeof CommandPrimitive>>(function Command(
  { className, ...props },
  ref,
) {
  return (
    <CommandPrimitive
      ref={ref}
      data-slot="command"
      className={cn("sg:flex sg:h-full sg:w-full sg:flex-col sg:overflow-hidden sg:bg-transparent sg:text-foreground", className)}
      {...props}
    />
  );
});

export const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & { wrapperClassName?: string }
>(function CommandInput({ className, wrapperClassName, ...props }, ref) {
  return (
    <div data-slot="command-input-wrapper" className={cn("sg:flex sg:h-9 sg:items-center sg:gap-2 sg:border-b sg:border-border sg:px-2.5", wrapperClassName)}>
      <SearchIcon className="sg:size-3.5 sg:shrink-0 sg:text-faint-foreground" />
      <CommandPrimitive.Input
        ref={ref}
        data-slot="command-input"
        className={cn(
          "sg:flex sg:h-full sg:w-full sg:bg-transparent sg:text-sm sg:outline-none sg:placeholder:text-faint-foreground sg:disabled:cursor-not-allowed sg:disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
});

export const CommandList = forwardRef<ElementRef<typeof CommandPrimitive.List>, ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(
  function CommandList({ className, ...props }, ref) {
    return (
      <CommandPrimitive.List
        ref={ref}
        data-slot="command-list"
        className={cn("sg:max-h-[280px] sg:scroll-py-1 sg:overflow-x-hidden sg:overflow-y-auto sg:p-1", className)}
        {...props}
      />
    );
  },
);

export function CommandEmpty({ className, ...props }: ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className={cn("sg:px-2 sg:py-5 sg:text-center sg:text-sm sg:text-muted-foreground", className)} {...props} />;
}

export function CommandLoading({ className, ...props }: ComponentPropsWithoutRef<typeof CommandPrimitive.Loading>) {
  return <CommandPrimitive.Loading className={cn("sg:px-2 sg:py-3 sg:text-sm sg:text-muted-foreground", className)} {...props} />;
}

export function CommandGroup({ className, ...props }: ComponentPropsWithoutRef<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "sg:overflow-hidden sg:text-foreground sg:[&_[cmdk-group-heading]]:px-2 sg:[&_[cmdk-group-heading]]:py-1.5 sg:[&_[cmdk-group-heading]]:text-xs sg:[&_[cmdk-group-heading]]:font-medium sg:[&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator className={cn("sg:-mx-1 sg:my-1 sg:h-px sg:bg-border", className)} {...props} />;
}

export const CommandItem = forwardRef<ElementRef<typeof CommandPrimitive.Item>, ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(
  function CommandItem({ className, ...props }, ref) {
    return (
      <CommandPrimitive.Item
        ref={ref}
        data-slot="command-item"
        className={cn(
          "sg:relative sg:flex sg:min-h-[30px] sg:cursor-default sg:items-center sg:gap-2 sg:rounded-md sg:px-2 sg:text-sm sg:outline-none sg:select-none",
          "sg:data-[selected=true]:bg-muted sg:data-[disabled=true]:pointer-events-none sg:data-[disabled=true]:opacity-50",
          "sg:[&_svg]:pointer-events-none sg:[&_svg:not([class*='size-'])]:size-4",
          className,
        )}
        {...props}
      />
    );
  },
);
