import type { DataSource } from "@ranjeetk25/schema-grid-core";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { Workbench } from "../support/Workbench";
import { USERS, createMemoryDataSource, createStorySchema, instrument } from "../support/shared";

/**
 * Story 9 — v0.4.1 capability-gated field types. The in-memory source here
 * reports `lookup: false` and `options: false` (a SQL view with no link
 * targets and no people directory, say):
 * - "Add column" offers no Link or User type (core `fieldTypeAvailability`);
 * - editing the existing Programs (link) / Owner (user) columns keeps their
 *   type, shown with the reason;
 * - the Programs / Owner cell pickers say "Linking isn't set up for this
 *   grid" / "People search isn't set up for this grid" instead of calling;
 * - Stage (creatable select) has no "+ Create".
 */
const meta: Meta = { title: "9. Capability-gated types" };
export default meta;

function GatedGrid() {
  const schema = useMemo(() => createStorySchema(), []);
  const memory = useMemo(() => createMemoryDataSource({ schema }), [schema]);
  const ds = useMemo(() => {
    const gated = Object.assign(Object.create(memory) as DataSource, {
      capabilities: async () => ({ ...(await memory.capabilities?.()), lookup: false, options: false }),
    });
    return instrument(gated);
  }, [memory]);
  return (
    <Workbench
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      height={520}
      title="Admissions"
      subtitle="No lookup, no options"
      onSchemaChange={(next) => {
        memory.setSchema(next);
        return next;
      }}
    />
  );
}

export const WithoutLookupOrOptions: StoryObj = { name: "Without lookup or options", render: () => <GatedGrid /> };
