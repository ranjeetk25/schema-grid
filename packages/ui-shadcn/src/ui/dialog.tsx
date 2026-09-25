import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type ComponentProps, type ElementRef, forwardRef } from "react";
import { SG_PORTAL, cn } from "../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Accessible name for the corner close button; `null` hides it. */
    closeLabel?: string | null;
    size?: "sm" | "md" | "lg" | "xl";
  }
>(function DialogContent({ className, children, closeLabel = "Close", size = "md", ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(
          SG_PORTAL,
          "sg:fixed sg:inset-0 sg:z-50 sg:bg-overlay sg:data-[state=open]:animate-overlay-in sg:data-[state=closed]:animate-overlay-out",
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          SG_PORTAL,
          "sg:fixed sg:top-1/2 sg:left-1/2 sg:z-50 sg:flex sg:max-h-[calc(100dvh-48px)] sg:w-[calc(100%-32px)] sg:-translate-x-1/2 sg:-translate-y-1/2 sg:flex-col",
          "sg:overflow-hidden sg:rounded-xl sg:bg-background sg:text-foreground sg:shadow-dialog sg:outline-none",
          "sg:data-[state=open]:animate-dialog-in sg:data-[state=closed]:animate-dialog-out",
          size === "sm" && "sg:max-w-[400px]",
          size === "md" && "sg:max-w-[520px]",
          size === "lg" && "sg:max-w-[720px]",
          size === "xl" && "sg:max-w-[920px]",
          className,
        )}
        {...props}
      >
        {children}
        {closeLabel !== null ? (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className={cn(
              "sg:absolute sg:top-4 sg:right-4 sg:inline-flex sg:size-7 sg:items-center sg:justify-center sg:rounded-md sg:text-muted-foreground",
              "sg:transition-colors sg:outline-none sg:hover:bg-muted sg:hover:text-foreground sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
            )}
          >
            <XIcon className="sg:size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("sg:flex sg:flex-col sg:gap-1 sg:px-6 sg:pt-5 sg:pr-14 sg:pb-4", className)} {...props} />;
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-body" className={cn("sg:min-h-0 sg:flex-1 sg:overflow-y-auto sg:px-6 sg:pb-6 sg:text-base", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("sg:flex sg:items-center sg:justify-end sg:gap-2 sg:border-t sg:border-border sg:bg-subtle sg:px-6 sg:py-3", className)}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function DialogTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn("sg:text-lg sg:font-semibold sg:tracking-[-0.01em]", className)} {...props} />;
  },
);

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn("sg:text-sm sg:text-muted-foreground", className)} {...props} />;
});
