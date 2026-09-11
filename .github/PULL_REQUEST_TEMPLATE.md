## What this changes

<!-- One paragraph. Link the issue if there is one. -->

## Tier

<!-- Tick every tier the diff touches. A pull request that touches the private tier is rejected by CI; see docs/FORKING.md. -->

- [ ] core (`src/core`, `src/cli`, scripts, tests of those)
- [ ] native provider: <name>
- [ ] contributed provider: <name> (maintainers reviewed: @handle)
- [ ] docs only

## Checklist

- [ ] Branched from `main` of this repository, not from a fork's main (`npm run check-sync-boundary` passes)
- [ ] Commit messages follow Conventional Commits
- [ ] `npm test` passes; `npm run test:coverage` passes for core changes
- [ ] Contract change: `CONTRACT_VERSION` bumped, goldens regenerated, CHANGELOG says so
- [ ] Provider change: the checklist in `docs/PROVIDER_AUTHORING.md` is done
- [ ] CHANGELOG line under Unreleased
