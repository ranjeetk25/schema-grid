import type { UserRef } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Avatar } from "../ui/avatar";

/** Core `UserRef` plus an optional UI-only avatar. */
type RenderableUser = UserRef & { avatarUrl?: string };

const isUserRef = (v: unknown): v is RenderableUser => !!v && typeof v === "object" && typeof (v as UserRef).id === "string";

/** Renders a user as an avatar (image, or tinted initials when there is none) plus their name (falls back to the id). */
export function UserRenderer({ value }: UiRendererProps<RenderableUser | string, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  const ref: RenderableUser = isUserRef(value) ? value : { id: String(value) };
  const name = ref.name ?? ref.id;
  return (
    <span className={cn(SG_ROOT, "sg:inline-flex sg:max-w-full sg:min-w-0 sg:cursor-default sg:items-center sg:gap-2 sg:align-middle")}>
      <Avatar name={name} src={ref.avatarUrl ?? null} size="sm" />
      <span className="sg:truncate">{name}</span>
    </span>
  );
}
