# Contributing

Thank you for working on aclif. This page covers how the repository is organised, what a pull request needs, and which decisions automation makes instead of a reviewer.

## Where things go

| Tier | Directory | Maintained by | Ships in releases | Accepted upstream |
|---|---|---|---|---|
| `native` | `src/providers/native/<name>/` | project maintainers | yes | yes |
| `contributed` | `src/providers/contributed/<name>/` | the handles in `plugin.maintainers`; project maintainers review only | yes | yes |
| `private` | `src/providers/private/<name>/` | a fork, for itself | no | never |

Core (`src/core/`, `src/cli/`) is maintained by the project. Tier is a property of the path; every provider meets the same conformance suite whatever its tier. The four `private/` prefixes (`src/providers/private/`, `test/providers/private/`, `test/fixtures/private/`, `docs/providers/private/`) are the sync boundary: upstream holds only a README in each and CI rejects pull requests that touch them. [docs/FORKING.md](docs/FORKING.md) explains the boundary and the promotion path from private to contributed.

## Before you open a pull request

1. Branch from `upstream/main` (this repository's `main`) so nothing under the boundary comes along. A branch from a fork's main would carry the private tier. `npm run check-sync-boundary` tells you before CI does.
2. Commits follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, with `!` or a `BREAKING CHANGE:` footer for breaking changes. The release automation computes the next version from the prefixes (`fix` patch, `feat` minor, breaking major); a commit hook checks the message format.
3. `npm test` passes locally: vitest, then lint and the circular-dependency check. `npm run test:coverage` enforces 80 percent line coverage on `src/core` and `src/cli`.
4. A change to the agent contract (envelope, errors, exit codes, metadata, introspection output, schemas) bumps `CONTRACT_VERSION`, regenerates the goldens (`npm run golden:capture`), and says so in the CHANGELOG.
5. A new or changed provider follows [docs/PROVIDER_AUTHORING.md](docs/PROVIDER_AUTHORING.md) and its pull request checklist. A new contributed provider names its maintainers in the plugin and in `.github/CODEOWNERS`.
6. Add a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for anything a user of the binary or the package would notice.
7. By opening a pull request you agree that your contribution is licensed under the [MIT License](LICENSE) that covers the project. New source files start with the same two-line SPDX header as the existing ones.

The pull request template asks which tier the change touches; answer it.

## What automation owns

These are declined as pull requests because a bot or a workflow owns them:

- Dependency bumps (Dependabot opens them weekly; passing patch and minor bumps merge on their own).
- Changes under `.github/`, the lint configuration, and the scripts block of `package.json`, unless the pull request is about them and says why.
- Version numbers and CHANGELOG release headings (the release workflow writes both).

## Reviews

A native provider or core change needs a maintainer review. A contributed provider change needs a review from one of its maintainers; project maintainers review only for contract and boundary questions. Reviews look first at what the conformance suite cannot judge: whether `aciMetadata` tells the truth about a command, whether the error hints name the command that fixes the problem, and whether examples and fixtures carry anything from a real deployment.

## Contributed provider stewardship

A contributed provider whose maintainers do not respond to review requests for two minor releases is moved out of the tree with a CHANGELOG note. Anyone can carry it on as a private provider from that commit, and it can come back the same way it arrived.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.
