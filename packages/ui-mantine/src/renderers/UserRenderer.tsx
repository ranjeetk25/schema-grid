import { Avatar, Group, Text } from "@mantine/core";
import type { UserRef } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";

const isUserRef = (v: unknown): v is UserRef => !!v && typeof v === "object" && "id" in v && "name" in v;

/** Renders a user as an avatar (image, or initials when there is none) plus their name. */
export function UserRenderer({ value }: UiRendererProps<string | UserRef, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  const user: UserRef = isUserRef(value) ? value : { id: String(value), name: String(value) };

  return (
    <Group gap="xs" wrap="nowrap">
      <Avatar src={user.avatarUrl ?? null} name={user.name} size="sm" radius="xl" color="initials" />
      <Text size="sm">{user.name}</Text>
    </Group>
  );
}
