import { Avatar, Group, Text } from "@mantine/core";
import type { UserRef } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";

/** Core `UserRef` plus an optional UI-only avatar. */
type RenderableUser = UserRef & { avatarUrl?: string };

const isUserRef = (v: unknown): v is RenderableUser =>
  !!v && typeof v === "object" && typeof (v as UserRef).id === "string";

/** Renders a user as an avatar (image, or initials when there is none) plus their name (falls back to the id). */
export function UserRenderer({ value }: UiRendererProps<RenderableUser | string, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  const ref: RenderableUser = isUserRef(value) ? value : { id: String(value) };
  const user = { ...ref, name: ref.name ?? ref.id };

  return (
    <Group gap="xs" wrap="nowrap">
      <Avatar src={user.avatarUrl ?? null} name={user.name} size="sm" radius="xl" color="initials" />
      <Text size="sm">{user.name}</Text>
    </Group>
  );
}
