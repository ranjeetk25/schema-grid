import { Avatar } from "@mantine/core";
import type { UserRef } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { CellBox } from "./CellBox";

/** Core `UserRef` plus an optional UI-only avatar. */
type RenderableUser = UserRef & { avatarUrl?: string };

const isUserRef = (v: unknown): v is RenderableUser =>
  !!v && typeof v === "object" && typeof (v as UserRef).id === "string";

/** A 20px avatar (image, or initials when there is none) plus the name (falls back to the id). */
export function UserRenderer({ value }: UiRendererProps<RenderableUser | string, unknown>) {
  if (value === null || value === undefined || value === "") return null;
  const ref: RenderableUser = isUserRef(value) ? value : { id: String(value) };
  const name = ref.name ?? ref.id;

  return (
    <CellBox style={{ gap: 8 }}>
      <Avatar
        src={ref.avatarUrl ?? null}
        name={name}
        alt={name}
        size={20}
        radius="xl"
        color="initials"
        styles={{ placeholder: { fontSize: 9, fontWeight: 600 } }}
        style={{ flexShrink: 0 }}
      />
      <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
    </CellBox>
  );
}
