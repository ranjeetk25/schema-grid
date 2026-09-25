import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("sg:inline-flex sg:h-8 sg:items-center sg:gap-0.5 sg:rounded-md sg:bg-muted sg:p-0.5 sg:text-muted-foreground", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "sg:inline-flex sg:h-7 sg:items-center sg:justify-center sg:gap-1.5 sg:rounded-[5px] sg:px-2.5 sg:text-sm sg:font-medium sg:whitespace-nowrap",
        "sg:transition-colors sg:outline-none sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring sg:hover:text-foreground",
        "sg:data-[state=active]:bg-background sg:data-[state=active]:text-foreground sg:data-[state=active]:shadow-xs sg:disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("sg:outline-none", className)} {...props} />;
}
