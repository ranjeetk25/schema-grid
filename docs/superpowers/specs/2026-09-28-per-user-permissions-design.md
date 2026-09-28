# Per-user column permissions

Status: approved (2026-09-28). Target release: **0.4.0** (ships with cell colors).

Goal: mark certain columns as editable (or viewable) by a selected few *people*, not only by roles, and manage that list in the grid's column settings.

## Principles

- **No new mechanism.** Extend the existing `RoleRule` so every current enforcement point (`plan-changes.ts`, `apply-changes.ts`, `rows-crud.ts`, the SQL-view write path, option `settableBy`, cell-color painting) picks it up unchanged.
- **Identity is server-derived.** Rules match `PermissionUser.id`, which the host builds from its authenticated session in `defineGrid({ source: ctx => … })`. Nothing the client sends is ever trusted as an identity.
- Backward compatible: existing `{ roles: [...] }` rules keep their meaning.

## 1. Core

```ts
export type RoleRule = "all" | { roles?: string[]; users?: string[] };
```

- A user matches when any of their roles is in `roles` **or** their `id` is in `users`. `superRoles` still bypass. `{}` or both lists empty = nobody.
- Put the rule match in one exported helper, `matchesRoleRule(rule, user, superRoles?)` in `permissions/`. It is used by `createRolePermissionResolver` and `canSetOption`, and there must be no second copy.
- Zod wire/schema validation accepts `users` (non-empty strings; the server dedupes on `updateSchema`). A rule with neither key is still valid (= nobody).
- `optionNotSettableMessage`: when the rule lists users, say "…can only be set by Admin or specific people". Never list user ids in messages.
- Every consumer that reads `rule.roles` directly must handle `roles` being absent. Grep all packages (`ui-mantine` `PermissionsStep.tsx`, `internal/options.ts`, `OptionListField.tsx`, the ui-shadcn equivalents, server, import-export).

## 2. Server

- **Redaction** (default on): `getSchema` (and the schema returned by `updateSchema`) sent to a caller **without** schema-write permission replaces every `users` list (column `permissions.read/edit` and option `settableBy`) with `[user.id]` when the caller is listed, else `[]`. The client resolver still computes the right access for that caller, and other people's ids are not disclosed. Callers with schema write get full lists. Opt out with `defineGrid({ redactPermissionUsers: false })`.
- Redaction must never feed back into storage. Non-writers cannot call `updateSchema` anyway; assert it in tests.
- The enforcement paths are unchanged apart from the shared matcher. Add tests proving a user-listed editor can write, an unlisted one is rejected on `applyChanges`, `createRows` (`rows-crud`) and the SQL-view update path, and that `superRoles` bypass works.

## 3. UI kits (ui-mantine and ui-shadcn, identical behaviour)

- New optional workbench prop (and column-builder prop):
  ```ts
  userDirectory?: {
    search(query: string): Promise<ActorRef[]>;
    resolve(ids: string[]): Promise<ActorRef[]>; // names for stored ids; unknown ids show as the raw id, marked "unknown user"
  };
  ```
- In the Permissions step, the "who can view" and "who can edit" controls get a **People** multi-select (async search via `userDirectory.search`) beside the roles picker. It is hidden entirely when `userDirectory` is absent, and existing `users` entries are then preserved untouched on save.
- Keep the existing invariants: edit-only people who can't view are auto-added to view, with the same notice the roles path uses. Summary text reads "Only Finance team and Priya, Rahul can edit" (names via `resolve`), and "N people" beyond 3 names.
- Option `settableBy` editor (OptionListField): same People picker.
- Tests in both kits; a Storybook story variant with a fake directory.

## 4. Docs

- `docs/consuming.md`: a "Per-person permissions" section with the guidance *per-person lists are for exceptions; use host roles for teams* (stale ids linger when people leave), plus redaction behaviour and `userDirectory` wiring.
- `docs/wire-contract.md`: the `RoleRule` shape.
- Changeset: part of the 0.4.0 minor (a separate changeset file is fine; the fixed group bumps all six).

## Out of scope

Row-level ownership rules ("only the assigned counsellor"; the resolver already receives `row`, so this can come later as a rule key), groups managed inside the grid, and audit of permission changes.
