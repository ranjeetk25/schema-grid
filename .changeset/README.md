# Changesets

Every PR that changes `packages/*` needs a changeset. Run `bun run changeset`,
pick the package(s) and the bump, write a consumer-facing summary, and commit
the generated file. Use `bun run changeset --empty` when no release is needed.

All `@masai/schema-grid-*` packages are one `fixed` group and always share a
version. More detail: [CONTRIBUTING.md](../CONTRIBUTING.md) and
[docs/releasing.md](../docs/releasing.md).
