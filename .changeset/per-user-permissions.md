---
"@ranjeetk25/schema-grid-core": minor
"@ranjeetk25/schema-grid-io": minor
"@ranjeetk25/schema-grid-server": minor
"@ranjeetk25/schema-grid-ag-grid": minor
"@ranjeetk25/schema-grid-ui-mantine": minor
"@ranjeetk25/schema-grid-ui-shadcn": minor
---

v0.4 — per-person column permissions: mark a column (or a select option) as viewable / editable by a few named people, not only by roles.

**Core**

- `RoleRule` is now `"all" | { roles?: string[]; users?: string[] }`. A user matches when any of their roles is in `roles` **or** their `PermissionUser.id` is in `users`; `superRoles` still bypass; `{}` or empty lists match nobody. Existing `{ roles }` rules keep their meaning. Code that read `rule.roles` directly must handle it being absent.
- New `matchesRoleRule(rule, user, superRoles?)`: the one matcher behind `createRolePermissionResolver` and `canSetOption` (so `applyChanges`, `createRows`, the SQL-view write path and option pickers all pick up `users`).
- Wire / option-config schemas accept `users` (non-empty ids). `optionNotSettableMessage` says "…can only be set by Admin or specific people" and never lists ids.

**Server**

- `getSchema` redacts per-person lists for callers without schema-write permission (`permission(ctx, "updateSchema")` + `schemaWritable`): every `users` list (column `permissions.read/edit`, option `settableBy`) becomes `[caller.id]` when the caller is listed, else `[]`. Writers get the full lists. Opt out with `defineGrid({ redactPermissionUsers: false })`.
- `defineGrid({ user: ctx => PermissionUser })` names the caller for redaction (default: `ctx.user` when it is a `{ id, roles }` object; no user → lists are emptied).
- `updateSchema` dedupes `users` lists before persisting.

**UI kits (ui-mantine, ui-shadcn)**

- New optional `userDirectory: { search(query), resolve(ids) }` prop on `<SchemaGridWorkbench>`, the column panel / form / builder dialog, `AccessSection` / `PermissionsStep` and `OptionListField`. It adds a People multi-select (async search) beside the roles pickers in "Who can access" and option "Who can set". Names come from `resolve`; unknown ids show the raw id marked "unknown user". Summaries read "Only Finance team and Priya, Rahul can edit" ("N people" beyond 3). Editors who can't view are added to view with the usual note.
- Without `userDirectory` the People pickers are hidden and stored `users` are kept untouched on save.
- Exports: `PeoplePicker`, `UserDirectory`, `UserDirectoryProvider`, `usePeopleNames`, `PeopleNames`.
