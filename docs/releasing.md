# Releasing

The five `@masai/schema-grid-*` packages are published to npmjs.com as public,
MIT-licensed packages by [Changesets](https://github.com/changesets/changesets)
running in GitHub Actions. Nobody runs `npm publish` by hand.

## How a release happens

1. Every PR that changes `packages/*` adds a changeset (`bun run changeset`,
   see [CONTRIBUTING.md](../CONTRIBUTING.md)). `changeset-check.yml` blocks PRs
   that forget one.
2. On each push to `main`, `release.yml` runs `changesets/action`:
   - If there are pending `.changeset/*.md` files, it opens or updates a PR
     titled **"chore: version packages"**. That PR bumps versions, writes
     `CHANGELOG.md` files and deletes the consumed changesets.
   - When you merge that PR, the next run finds unpublished versions and runs
     `bun run release`, which does:
     1. `bun run build`
     2. `bun scripts/verify-pack.ts`: packs every package in a scratch copy and
        fails if a tarball is wrong
     3. `bun scripts/prepare-publish.ts --write`: rewrites each `package.json`
        into its npm form (below)
     4. `bun scripts/prepare-publish.ts --check`
     5. `changeset publish`: `npm publish --provenance` per package, git tags
        `@masai/schema-grid-core@x.y.z`, and GitHub Releases
3. The workflow summary lists what was published.

### Why the manifests are rewritten at publish time

In the repo, every `exports` entry has a `development` condition pointing at
`./src/*.ts`. Storybook, demo-api and vitest use it to run from source without a
build. That condition must not reach npm:

- `src/` is not in `files`, so it is not in the tarball.
- Vite and webpack turn the `development` condition on in dev mode.

A consumer's dev server would therefore resolve `@masai/schema-grid-core` to
`./src/index.ts`, find no such file, and fail. Production builds would work, so
the bug would only show up on developer machines.

Internal dependencies are also written as `workspace:*`. `changeset publish`
publishes with the npm CLI, and npm does not rewrite that protocol (pnpm and
bun do). Left alone, npm would publish a literal `"workspace:*"` that nobody can
install.

`scripts/publish-manifest.ts` fixes both: it strips every `development`
condition and turns `workspace:*` into the exact sibling version (all packages
share one version, see below). The rewrite is done in place, before npm reads
the manifest, so the tarball and the registry metadata both get the clean form.
It is never committed; the CI checkout is thrown away.

We did not use `publishConfig.exports`. npm reads `publishConfig` only as
CLI config (`registry`, `tag`, `access`, `provenance`), never as manifest
overrides, so the `development` condition would still ship. That override is a
pnpm and Yarn feature.

Guards:

- `scripts/publish-manifest.test.ts` (part of `bun run test`) unit-tests the
  transform. It checks that every publishable package is publish-ready after
  the transform, and that the raw manifest is not (so the transform is really
  needed). If `dist/` exists, it also packs `core` and reads `package.json` back
  out of the tarball.
- `bun run verify:pack` (a CI step after the build, and step 2 of every
  release) packs all packages with `npm pack` and checks each tarball:
  - it contains only `package.json`, `README.md`, `LICENSE` and `dist/**`
  - no `development` condition and no `workspace:` range remain
  - the MIT, repository, `publishConfig` and `engines` metadata is present
  - every `exports`/`main`/`module`/`types` target exists in the tarball

A new package under `packages/` that is not `"private": true` is picked up
automatically, and fails these checks until it has the same metadata block
(`license`, `repository.directory`, `homepage`, `bugs`, `publishConfig`,
`files`, `engines`).

### Why one version for everything (`fixed`)

`.changeset/config.json` puts `@masai/schema-grid-*` in one `fixed` group. Any
release bumps every package to the same version, even packages that did not
change.

- The packages are one product split along dependency lines. `ui-mantine`
  depends on `ag-grid`, `core` and `io`, and the wire contract is shared by
  `core`, `server` and `ag-grid`. Mixed versions are the most likely way to
  break a consumer, and the hardest to debug.
- Consumers only need one rule: "all `@masai/schema-grid-*` at the same
  version". Renovate or Dependabot can group them with one pattern.
- Internal dependencies are published as exact versions, so installs always
  get a set that was tested together.
- The cost is that some releases change nothing in some packages. That costs
  about one version number, which is cheap.

`linked` (shared version numbers, but only changed packages bump) was
rejected. You would still need a compatibility matrix to know which versions
work together.

Two related settings:

- `onlyUpdatePeerDependentsWhenOutOfRange`: without it, Changesets
  major-bumps any package with an internal peer dependency (`ag-grid` peers on
  `io`), so the first release would have been 1.0.0 instead of 0.1.0.
- `privatePackages: { version: false, tag: false }`: `apps/*` are never
  versioned or tagged.

## One-time setup (repo owner)

Do these in order. Steps a to d happen once. Step e is the first release.

### (a) Create the npm org `masai`

1. Sign in at <https://www.npmjs.com> with the account that should own the
   packages. Turn on 2FA, which npm requires for org owners.
2. Go to **Add Organization** at <https://www.npmjs.com/org/create>, name it
   `masai`, and pick the free plan (unlimited public packages).
3. Optionally add other maintainers under **Members**.

**If `masai` is taken or unavailable**, pick another scope (for example
`masai-school`) and rename every reference in the repo:

```bash
bun scripts/rename-scope.ts --to @masai-school            # dry run: lists files and counts
bun scripts/rename-scope.ts --to @masai-school --write    # apply
bun install && bun run typecheck && bun run test && bun run build && bun run verify:pack
git diff    # review, then commit on a branch and open a PR
```

The script only rewrites `@masai/schema-grid…` tokens in git-tracked text
files. It updates package names, imports, docs, the changeset `fixed` glob and
the changeset front-matter. Anything else under `@masai/` is left alone. Update
the scope in the admissions app's imports the same way.

### (b) Create an npm token and add it as `NPM_TOKEN`

1. npmjs.com, then avatar, then **Access Tokens**, then
   **Generate New Token**, then **Granular Access Token**.
2. Fill in the form:
   - Name: `schema-grid GitHub Actions`
   - Expiration: the longest you accept (maximum 365 days; set a reminder to
     rotate it)
   - Packages and scopes: **Read and write**, scope `@masai` (packages do not
     exist yet, so select the scope, not individual packages)
   - Organizations: no access needed
   - Allowed IP ranges: leave empty (GitHub runners have no fixed IPs)
   - If the form offers **Bypass 2FA** / automation use, enable it. Without
     it, CI publishes fail with `EOTP`.
3. In GitHub, open the repo's **Settings**, then **Secrets and variables**,
   then **Actions**, then **New repository secret**. Set the name to `NPM_TOKEN`
   and paste the token.

Alternative with no stored token: npm **trusted publishing** (OIDC). This only
works after each package exists on npm. Once the first release is out, you can
add a trusted publisher on each package's **Settings** page (repository
`ranjeetk25/schema-grid`, workflow `release.yml`) and then delete `NPM_TOKEN`.
It needs npm 11.5.1 or newer in the release job
(`npm install -g npm@latest` before publishing).

### (c) Let Actions open PRs

Open **Settings**, then **Actions**, then **General**, then
**Workflow permissions**:

- select **Read and write permissions**
- tick **Allow GitHub Actions to create and approve pull requests**

Without this, the "chore: version packages" PR cannot be opened.

Note that PRs opened with `GITHUB_TOKEN` do not trigger other workflows. CI will
not run on the version PR by itself. Close and reopen it, or push an empty
commit to it, if you want the checks. The version PR only touches versions and
changelogs, and the release job builds and verifies everything again before
publishing.

### (d) Make the repository public

**Settings**, then **General**, then **Danger Zone**, then
**Change visibility**, then **Public**.

This is required. npm refuses provenance from a private repository
(`Unsupported GitHub Actions source repository visibility: "private"`). Do it
before the first release. If the repo has to stay private for a while, set
`"provenance": false` in each package's `publishConfig` and drop
`NPM_CONFIG_PROVENANCE` from the workflows until it is public.

Before flipping, check that nothing private is in the git history:
`git log -p | grep -iE "password|secret|token|api[_-]?key"`, `.env` files, and
customer data in fixtures or screenshots (`docs/design/`).

Optional in the same Settings pass:

- **Labels**: create `skip-changeset` and `preview` (the workflows only read
  them).
- **Storybook on Pages**:
  1. Under **Settings**, then **Pages**, set Source to **GitHub Actions**.
  2. Under **Settings**, then **Secrets and variables**, then **Actions**,
     then **Variables**, add `DEPLOY_STORYBOOK` = `true`.
  3. Optionally add `STORYBOOK_DEMO_API_URL` pointing at a hosted demo-api.
     Stories that call the demo API need it.

  The site is then at `https://ranjeetk25.github.io/schema-grid/`, with
  `/mantine/` and, once `apps/storybook-shadcn` exists, `/shadcn/`.
- **Branch protection on `main`**: require the `CI` and `Changeset check`
  workflows.

### (e) First release

The repo already has `.changeset/initial-public-release.md`, which bumps every
package from 0.0.1 to **0.1.0**.

1. Merge the PR that adds this release setup to `main`.
2. `release.yml` runs and opens **"chore: version packages"**. Check that every
   package goes to `0.1.0` and gets a `CHANGELOG.md`.
3. Merge that PR. `release.yml` runs again and publishes the 5 packages.
4. Verify:
   - <https://www.npmjs.com/package/@masai/schema-grid-core> shows 0.1.0 with a
     **Provenance** badge.
   - `npm view @masai/schema-grid-core@0.1.0 exports` has no `development` key.
   - `npm view @masai/schema-grid-ui-mantine@0.1.0 dependencies` shows
     `@masai/schema-grid-core: 0.1.0`, not `workspace:*`.
   - The repo has tags `@masai/schema-grid-*@0.1.0` and GitHub Releases.
5. Install it in the admissions monorepo, following
   [consuming.md](./consuming.md).

If a publish fails partway, re-run the job. `changeset publish` skips versions
that are already on npm and publishes the rest.

## Day-to-day

| Task | How |
|---|---|
| Ship a change | PR with a changeset, then merge. Merge the version PR when you want to release. You can batch many PRs into one release. |
| See what the next release contains | `bunx changeset status --verbose` |
| Test a PR in the admissions app | add the `preview` label; the bot comments `bun add …@0.0.0-pr<N>-<sha7>` |
| Change that needs no release (tests, docs inside a package) | `bun run changeset --empty`, or the `skip-changeset` label |
| Pre-release channel (`1.0.0-beta.N`) | `bunx changeset pre enter beta`, commit, and release as usual. `bunx changeset pre exit` when done. |
| Deprecate a bad version | `npm deprecate @masai/schema-grid-core@0.3.1 "broken: use 0.3.2"` for each package (needs an npm login with publish rights). Do not unpublish. |

Never run `npm publish` from a package folder. It would ship the
`workspace:*`/`development` manifest. Only the release scripts publish.

## Files

| File | Role |
|---|---|
| `.changeset/config.json` | `fixed` group, public access, snapshot template, private apps excluded |
| `.github/workflows/release.yml` | version PR or publish on push to `main` |
| `.github/workflows/preview-release.yml` | `preview` label: snapshot publish to dist-tag `pr` |
| `.github/workflows/changeset-check.yml` | requires a changeset on PRs that touch `packages/*` |
| `.github/workflows/pages.yml` | Storybook to GitHub Pages, gated on `DEPLOY_STORYBOOK` |
| `.github/workflows/ci.yml` | lint, typecheck, test, build, `verify:pack` |
| `scripts/publish-manifest.ts` | the publish transform and publish-readiness rules |
| `scripts/prepare-publish.ts` | applies the transform in the release job |
| `scripts/verify-pack.ts` | packs and inspects every tarball |
| `scripts/rename-scope.ts` | fallback scope rename |
