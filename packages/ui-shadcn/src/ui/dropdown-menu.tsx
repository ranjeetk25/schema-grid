import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type ElementRef, type ReactNode, forwardRef } from "react";
import { SG_PORTAL, cn } from "../lib/cn";
import { floatingSurface } from "./surface";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

const itemBase = cn(
  "sg:relative sg:flex sg:h-[30px] sg:cursor-default sg:items-center sg:gap-2 sg:rounded-md sg:px-2 sg:text-sm sg:outline-none sg:select-none",
  "sg:data-[highlighted]:bg-muted sg:data-[disabled]:pointer-events-none sg:data-[disabled]:opacity-50",
  "sg:[&_svg]:pointer-events-none sg:[&_svg:not([class*='size-'])]:size-4 sg:[&_svg:not([class*='text-'])]:text-muted-foreground",
);

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof MenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Content> & { portalled?: boolean }
>(function DropdownMenuContent({ className, sideOffset = 6, align = "start", portalled = true, ...props }, ref) {
  const content = (
    <MenuPrimitive.Content
      ref={ref}
      data-slot="dropdown-menu-content"
      sideOffset={sideOffset}
      align={align}
      collisionPadding={8}
      className={cn(
        SG_PORTAL,
        floatingSurface,
        "sg:min-w-48 sg:overflow-x-hidden sg:overflow-y-auto sg:p-1 sg:max-h-[var(--radix-dropdown-menu-content-available-height)]",
        "sg:origin-[var(--radix-dropdown-menu-content-transform-origin)]",
        className,
      )}
      {...props}
    />
  );
  return portalled ? <MenuPrimitive.Portal>{content}</MenuPrimitive.Portal> : content;
});

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof MenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & { variant?: "default" | "danger"; shortcut?: ReactNode }
>(function DropdownMenuItem({ className, variant = "default", shortcut, children, ...props }, ref) {
  return (
    <MenuPrimitive.Item
      ref={ref}
      data-slot="dropdown-menu-item"
      className={cn(itemBase, variant === "danger" && "sg:text-danger sg:data-[highlighted]:bg-danger-subtle sg:[&_svg]:!text-danger", className)}
      {...props}
    >
      {children}
      {shortcut ? <span className="sg:ml-auto sg:pl-4 sg:text-xs sg:text-muted-foreground">{shortcut}</span> : null}
    </MenuPrimitive.Item>
  );
});

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof MenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.CheckboxItem ref={ref} className={cn(itemBase, "sg:pr-8", className)} {...props}>
      {children}
      <span className="sg:absolute sg:right-2 sg:flex sg:size-4 sg:items-center sg:justify-center">
        <MenuPrimitive.ItemIndicator>
          <CheckIcon className="sg:size-4 sg:!text-primary" />
        </MenuPrimitive.ItemIndicator>
      </span>
    </MenuPrimitive.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof MenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.RadioItem ref={ref} className={cn(itemBase, "sg:pr-8", className)} {...props}>
      {children}
      <span className="sg:absolute sg:right-2 sg:flex sg:size-4 sg:items-center sg:justify-center">
        <MenuPrimitive.ItemIndicator>
          <CheckIcon className="sg:size-4 sg:!text-primary" />
        </MenuPrimitive.ItemIndicator>
      </span>
    </MenuPrimitive.RadioItem>
  );
});

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("sg:px-2 sg:pt-1.5 sg:pb-1 sg:text-xs sg:font-medium sg:text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("sg:-mx-1 sg:my-1 sg:h-px sg:bg-border", className)} {...props} />;
}

export const DropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof MenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger>
>(function DropdownMenuSubTrigger({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.SubTrigger ref={ref} className={cn(itemBase, "sg:data-[state=open]:bg-muted", className)} {...props}>
      {children}
      <ChevronRightIcon className="sg:ml-auto sg:size-3.5" />
    </MenuPrimitive.SubTrigger>
  );
});

export const DropdownMenuSubContent = forwardRef<
  ElementRef<typeof MenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent ref={ref} className={cn(SG_PORTAL, floatingSurface, "sg:min-w-40 sg:p-1", className)} {...props} />
    </MenuPrimitive.Portal>
  );
});
