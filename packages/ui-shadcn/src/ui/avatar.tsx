import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "../lib/cn";

/** "Asha Rao" → "AR"; one word → its first two letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

const HUES = ["red", "orange", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo", "violet", "grape", "pink"] as const;

/** Stable tone for a name, so a user's initials keep their colour everywhere. */
export function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length] ?? "gray";
}

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}

export function Avatar({ name, src, size = "sm", className }: AvatarProps) {
  const tone = avatarTone(name);
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "sg:relative sg:inline-flex sg:shrink-0 sg:overflow-hidden sg:rounded-full sg:select-none",
        size === "xs" && "sg:size-4 sg:text-[8px]",
        size === "sm" && "sg:size-5 sg:text-[9px]",
        size === "md" && "sg:size-7 sg:text-2xs",
        className,
      )}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="sg:aspect-square sg:size-full sg:object-cover" /> : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="sg:flex sg:size-full sg:items-center sg:justify-center sg:font-semibold sg:leading-none"
        style={{ backgroundColor: `var(--sg-tone-${tone}-bg)`, color: `var(--sg-tone-${tone}-fg)` }}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
