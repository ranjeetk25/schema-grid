# Contributing

## Setup

```bash
bun install
bun run typecheck && bun run test && bun run build && bun run lint
```

## Changesets: one per PR that changes a package

Releases are driven by [Changesets](https://github.com/changesets/changesets).
If your PR changes anything under `packages/*`, add a changeset:

```bash
bun run changeset
```

1. Select the package(s) you changed. All `@ranjeetk25/schema-grid-*` packages
   release together at one version (a `fixed` group), so picking the one you
   touched is enough.
2. Pick the bump:
   - `patch`: bug fix, no API change
   - `minor`: new feature; while we are on `0.x`, also any breaking change
     (say so in the summary)
   - `major`: breaking change once we are on `1.x`
3. Write the summary for **consumers**. It goes into `CHANGELOG.md` and the
   GitHub Release as-is. Say what changed and what they need to do.
4. Commit the generated `.changeset/<random-name>.md` with your PR.

Example `.changeset/brave-ducks-dance.md`:

```md
---
"@ranjeetk25/schema-grid-ag-grid": patch
---

Fill handle no longer overwrites read-only cells when dragging across a formula column.
```

**No release needed** (tests, internal refactor, README tweak inside a package)?
Run `bun run changeset --empty`, or ask a maintainer for the `skip-changeset`
label.

Changes to `apps/*`, `docs/`, root config and workflows never need a changeset.

The **Changeset check** workflow runs `changeset status --since=origin/main`
and fails a PR that touches `packages/*` without one.

## Trying your PR in another app

Ask a maintainer to add the `preview` label. CI publishes
`0.0.0-pr<N>-<sha7>` to the `pr` dist-tag and comments the install command. See
[docs/consuming.md](docs/consuming.md#testing-a-pr-before-it-is-released).

## Releasing

Maintainers only: see [docs/releasing.md](docs/releasing.md). Never run
`npm publish` locally.

## Package manifests

Keep the `development` condition first in each `exports` entry and use
`workspace:*` for internal dependencies. The release scripts rewrite both for
npm. A new publishable package needs the same metadata block as the existing
ones: `license`, `repository`, `homepage`, `bugs`, `publishConfig`, `files`,
`engines`. `bun run verify:pack` (after `bun run build`) tells you what is
missing.
