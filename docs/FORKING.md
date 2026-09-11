# Forking, private providers, and contributing back

There are two ways to add a provider that upstream will never see, and one way to give upstream a provider or a fix. With all three, `git merge upstream/main` never produces a conflict in your providers.

## Route 1: a CLI package (recommended)

Most teams do not need a fork at all. A CLI package depends on `aclif` from npm, names itself, picks its providers, and declares its own in its own tree:

```ts
// src/index.ts of the mycli package
import {defineCli} from 'aclif'
import {salesforcePlugin, servicenowPlugin} from 'aclif/providers'
import {acmePlugin} from './providers/acme/plugin.js'

export const {COMMANDS, registry} = defineCli({bin: 'mycli', providers: [salesforcePlugin, servicenowPlugin, acmePlugin]})
```

`npx --package aclif aclif-scaffold-cli --name mycli --dir ../mycli --providers salesforce,servicenow` writes the package. Upgrading the framework is `npm update aclif`. Your providers are written exactly as described in [PROVIDER_AUTHORING.md](PROVIDER_AUTHORING.md) and are tier `private` in that CLI. See [BUILDING_A_CLI.md](BUILDING_A_CLI.md).

Take this route unless you also need to change the framework's core.

## Route 2: a fork with the private tier

Fork this repository when you change core as well as add providers. Your providers go under `src/providers/private/<name>/`, with tests under `test/providers/private/`, fixtures under `test/fixtures/private/`, and setup notes under `docs/providers/private/`. Those four prefixes are the **sync boundary**: upstream commits nothing there except a README in each, and upstream CI rejects any pull request that touches them.

### What upstream promises

1. Nothing under the four `private/` prefixes changes upstream, so a pull never conflicts with your providers.
2. No upstream file needs editing when you add a provider. The index generator finds the directory; the topic table is regenerated after the build. The one exception is `package.json` dependencies when a provider needs a protocol library, and that merge is trivial.
3. Core never imports from a provider directory, and providers never import each other (`C-TIER-1`), so upstream reorganising its own providers cannot break yours.
4. Provider names are unique across tiers. If upstream later adds a provider with the same name as your private one, your build fails at index generation with both paths named; rename or drop your copy. That is the one case a pull can break the build, and it fails loudly.

### Working in a fork

```bash
git remote add upstream https://github.com/agent-cli-framework/aclif.git

# add a provider
npm run scaffold-provider -- --tier private --name acme --display "Acme Widgets"
npm run build && npx vitest run test/conformance

# build only some tiers, or drop individual providers, without deleting anything
ACI_PROVIDER_TIERS=native,private npm run build
ACI_EXCLUDE_PROVIDERS=google npm run build

# pull upstream
git fetch upstream && git merge upstream/main
```

The generated `src/providers/index.generated.ts` is gitignored, so it never conflicts either. Your CI runs the same workflow as upstream: it builds every tier present, runs conformance over your providers too, runs the secret scan over the whole tree including `private/`, and skips the sync-boundary job unless you opt in (set the repository variable `RUN_SYNC_BOUNDARY=true` and point the `upstream` remote at your own upstream).

Private providers may extend the dependency allowlist with `src/providers/private/dependency-allowlist.json` (`{"packages": {"name": "reason"}}`). The de-branding rule (`C-EX-3`) does not apply to the private tier: your hostnames and tenant names are your business. Everything else in the conformance suite applies unchanged.

### GitHub forks and private repositories

GitHub does not allow a fork of a public repository to be private, and detaches private forks when the parent's visibility changes. A fork that must stay private is created as an independent repository, seeded from upstream, with upstream added as a remote; git does not care which button created it.

## Route 3: contributing back

### A core fix

Branch from `upstream/main` so the branch contains nothing under the boundary. A branch from your fork's main would carry the private tier with it:

```bash
git fetch upstream
git checkout -b fix/pool-eviction upstream/main
# cherry-pick or make the change
npm run check-sync-boundary        # diffs against upstream/main and fails on any private path
```

Open the pull request against upstream. Its CI runs the same check (`K-7`); the local run only saves you a round trip. Commits follow Conventional Commits (`fix:`, `feat:`, `docs:`, ...); the release automation reads the prefixes.

### Promoting a provider to the contributed tier

Same as a core fix, with the directory moved:

```bash
git checkout -b feat/acme-provider upstream/main
git mv src/providers/private/acme src/providers/contributed/acme     # after copying it onto this branch
git mv test/providers/private/acme test/providers/contributed/acme
git mv test/fixtures/private/acme test/fixtures/contributed/acme
git mv docs/providers/private/acme docs/providers/contributed/acme
```

Then fill in `maintainers` on the plugin (GitHub handles), add the matching line to `.github/CODEOWNERS`, make sure the fixtures carry no real tenant data and the examples use example.com identities (`C-EX-3` starts applying), regenerate the goldens, and add a CHANGELOG line. Contributed providers are maintained by the people named in `maintainers`; project maintainers review only. A contributed provider whose maintainer stops responding for two minor releases is moved out of the tree with a CHANGELOG note, and anyone can carry it as a private provider from that commit.

## What is not offered

An oclif plugin installed with `plugins install` is not a route today: the registry is built from `defineCli()` and the in-tree tiers, and there is no hook for a plugin package to register providers. A published provider package can still be consumed by a CLI package (route 1) that imports its plugin and passes it to `defineCli()`.
