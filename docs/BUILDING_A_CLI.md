# Building a CLI on aclif

aclif is a framework, in the same sense that oclif is one. The framework
package ships the contracts, the base command, the hooks, the embedded
runtime, the provider plugin API, and a set of built-in providers. A CLI
is a separate package that names itself, picks its providers, and gets
everything else from the framework. The `aclif` binary in this repository
is one such CLI, kept as the reference.

## Scaffold

```bash
npx --package @aclif/core aclif-scaffold-cli --name mycli --dir ../mycli --providers salesforce,servicenow
cd ../mycli && npm install && npm run build
./bin/run.js discover --json
```

The scaffold writes a complete package, including an MIT `LICENSE` that names `--author` as the copyright holder (default: `mycli authors`); pass your own name or edit the file if your CLI ships under other terms. Its heart is one file:

```ts
// src/index.ts
import {defineCli} from 'aclif'
import {salesforcePlugin, servicenowPlugin} from 'aclif/providers'
import {acmePlugin} from './providers/acme/plugin.js'

export const {COMMANDS, registry} = defineCli({
  bin: 'mycli',
  providers: [salesforcePlugin, servicenowPlugin, acmePlugin],
})
```

`package.json` points oclif at that module (`oclif.commands` with the
explicit strategy, `target: ./lib/index.js`, `identifier: COMMANDS`) and
at three one-line hook files that re-export the framework's hooks.
`oclif.helpClass` points at a fourth one-line file, `src/help.ts`, that
re-exports `aclif/help`, which renders `$BIN` in help output. Nothing else
in the CLI package touches the framework's internals.

## What the CLI's name controls

Everything an operator or an agent sees is derived from `bin`:

| Surface | mycli gets |
|---|---|
| Command strings in examples, hints, next-command suggestions | `mycli salesforce data query ...` (authored as `$BIN`, rendered at emit) |
| Config and cache directories | `~/.config/mycli/config.yaml`, `~/.cache/mycli/` (oclif's `dirname`) |
| Framework environment variables | `MYCLI_PROFILE`, `MYCLI_INSTANCE`, `MYCLI_IDENTITY_TOKEN`, `MYCLI_IDENTITY_SECRET`, `MYCLI_NO_MANIFESTS` (the framework's `ACLIF_*` names still work as a fallback) |
| Config directory override | `MYCLI_CONFIG_DIR` (oclif) |
| Audit line, `auth status`, `discover`, `learn` | this CLI's providers only, in the tiers it assigned |

Provider credential variables (`SF_INSTANCE_URL`, `SN_ACCESS_TOKEN`, and
so on) are declared by each provider's credential schema and do not
change with the CLI's name.

## Providers

`defineCli` takes plugins or `{plugin, tier}` entries. A bare plugin is
tier `private`: it belongs to this CLI. To keep the framework's tiers
visible, pass the entries from `aclif/providers`:

```ts
import {PROVIDER_ENTRIES} from 'aclif/providers'   // every built-in, with its tier
defineCli({bin: 'mycli', providers: [...PROVIDER_ENTRIES, {plugin: acmePlugin, tier: 'private'}]})
```

The CLI's own providers live in its repository under `src/providers/`,
written to the same contract as the built-in ones (see
`PROVIDER_AUTHORING.md`); the conformance suite runs against them the
same way. Nothing in the CLI needs the framework's fork machinery: the
private tier of a CLI package consists of the providers it declares.

## Testing your providers

The framework's conformance suite is importable from `aclif/testing`, and the scaffold writes a test that runs it:

```ts
// test/conformance.test.ts
import {conformanceSuite} from 'aclif/testing'
import {registry} from '../src/index.js'

conformanceSuite({
  registry,
  cliRoot: process.cwd(),
  sourceDirs: [{dir: 'src/providers', tier: 'private'}],
  dependencyAllowlist: 'src/providers/dependency-allowlist.json',
})
```

`npm run build && npm test` checks every provider whose directory sits under `src/providers/`: complete safety metadata, `--dry-run` before any client use, exit 3 with every auth path named when credentials are absent, a `SETUP.md` per provider under `docs/providers/<name>/`, examples that parse, and the source rules in [PROVIDER_AUTHORING.md](PROVIDER_AUTHORING.md). Providers imported from `aclif/providers` are checked upstream and skipped here. A provider with a tenant walk, an http adapter, or session support needs a fake in the options (`tenantFakes`, `httpFakes`, `sessionFakes`); the failing test names which.

The same module exports `providerHarness` for fixture tests over an msw server, `captureGoldens` for golden introspection files, and `runBinary` for end-to-end runs of your built binary. vitest, msw, and ajv are optional peer dependencies of the framework; the scaffold adds them to `devDependencies`.

## Embedding

A host that embeds the runtime loads the CLI package, which gives it that CLI's providers and name:

```ts
import {Runtime} from 'aclif'
const runtime = await Runtime.start({cliRoot: '/path/to/mycli'})
```

`Runtime.start` loads the CLI's oclif config first, which runs its
`defineCli()`, so the runtime serves that CLI's providers and renders its
name. Manifest, tenant, alias, and credential stores are supplied per
invocation as before.

## Extra commands and opting out

`defineCli({commands: {'mycli:doctor': Doctor}})` adds commands of the
CLI's own. `coreCommands: false` drops `discover`, `learn`, `aliases`,
`auth`, and `manifests`; `manifests: false` skips reading the config
file's `manifests:` section at catalog build.

## Releasing

The scaffolded package builds with `tsc`, emits its oclif topic table
from its registry after each build, and generates `oclif.manifest.json`
on `prepack`. Publish it like any oclif CLI: `npm publish`, or `oclif
pack` for installers.
