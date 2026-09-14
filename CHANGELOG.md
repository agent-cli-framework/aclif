# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); release headings are written by the release workflow from Conventional Commit messages. Contract changes name the `CONTRACT_VERSION` they move to.

## Unreleased

### Added

- `skills/aclif/`, a skill for agents that use the binary: `SKILL.md` holds the workflow and rules, `reference.md` the flags, envelope, exit codes, and command topology. The directory is included in the npm package. `docs/USING_WITH_AGENTS.md` is now the page that says how to install it; the content it held moved into the skill.
- The CLI scaffold writes an MIT `LICENSE` and sets `author` in `package.json`, both naming `--author` (default: `<name> authors`) as the copyright holder. A scaffolded package previously declared `license: MIT` without shipping the license text.

### Changed

- The generated provider index carries the same SPDX header as the rest of the shipped source.
- `package.json` names the author as `Prompt One, Inc.`, matching `LICENSE` and the source headers.
- The package description, the README, and `AGENTS.md` state what aclif is in the same words as the project site: command-line tools for AI agents, one grammar and canonical names across every SaaS provider. The README leads with why agents need their own CLI, lists what every command gives you in the site's order, names the three deployments as the site does (run by the agent, by a host application, by a gateway), and says "instance" where it said "tenant"; "tenant catalog" keeps its name. `PROVIDER_AUTHORING.md` now points at the `add-provider` skill. `MOTIVATION.md` starts from the incentive, no unnecessary tokens and deterministic execution, shows where MCP and run-time inference fall short, and describes the compiled workflow agent at design time and at run time; published work is cited in one closing paragraph.

## [1.2.0] - 2026-09-12

### Changed

- oclif core 5 (`@oclif/core` `^5.0.0`), with `oclif` 6 and `@oclif/test` 5 in development. oclif 5 changes nothing in the API the framework uses; its one breaking change is the Node 22 floor the framework already had. One copy of oclif core in the tree again.
- The `@oclif/plugin-help` and `@oclif/plugin-plugins` plugins are no longer part of the framework or of a scaffolded CLI. `--help` on the root and on every command is rendered by oclif core as before; the `help` topic command and the `plugins` commands are gone, and the root topic listings (`--discover` on the core commands) no longer show them. A CLI declares its providers in `defineCli()`; runtime plugin installation was never part of the design, and the two plugins brought `npm`, `yarn`, and about 200 packages with them. A production install of the framework drops from 471 packages (165 MB) to 270 (140 MB).
- The CLI scaffold writes `@oclif/core` `^5.0.0`, `oclif` `^6.0.0`, and a framework dependency of `^1.2.0`. An existing downstream CLI follows by making the same three edits to its `package.json` and removing `oclif.plugins`.

### Removed

- `ts-node` from the development dependencies; `tsx` is the loader the scripts use.

### Added (from commits)

- oclif core 5; drop the help and plugins oclif plugins from the framework and the scaffold (18de8d9)

## [1.1.3] - 2026-09-12

### Fixed (from commits)

- **deps**: bump js-yaml from 4.1.1 to 5.4.1 (#8) (69b977a)
- **deps**: bump @googleapis/calendar from 9.8.0 to 16.0.0 (#6) (35f68b7)
- **deps**: bump @oclif/plugin-plugins from 5.4.59 to 6.0.1 (#5) (8e73231)

## [1.1.2] - 2026-09-12

### Fixed (from commits)

- **deps**: bump @googleapis/gmail from 8.0.0 to 18.0.0 (#4) (937fae1)

## [1.1.1] - 2026-09-12

### Fixed

- `aclif/testing` switches off oclif's lib-to-src path mapping when imported (`settings.enableAutoTranspile = false`). Under vitest NODE_ENV is `test`, and oclif then resolved a downstream CLI's commands to `src/*.ts` and failed `Config.load` with "Unknown file extension .ts" in any package without tsx. The `OCLIF_TS_NODE` variable the suite set is not read by oclif.

### Fixed (from commits)

- **testing**: run the compiled package under vitest; OCLIF_TS_NODE is not read by oclif (5ef60df)

## [1.1.0] - 2026-09-12

### Added

- `aclif/testing`: the conformance suite (`conformanceSuite` and its four parts), golden capture, the in-process and binary runners, the msw harness, and the schema validators, importable by a CLI package built on the framework. vitest, msw, and ajv become optional peer dependencies. The CLI scaffold writes a `test/conformance.test.ts` and a vitest config.
- The package root exports `inferType`, `inferFieldsFromRecord`, `humanizeLabel`, `InferredField`, and `withDnsRetry`, so a provider in a downstream package imports everything it needs from `aclif`.

### Added (from commits)

- aclif/testing, the conformance suite as a library (8917a84)
- export the schema-inference helpers and withDnsRetry from the package root (a6292c1)

### Fixed (from commits)

- **testing**: http fakes are a function of the provider name (288ea9e)

### Changed (from commits)

- contributor AGENTS.md, CLAUDE.md, and the add-provider skill (ecb5d2a)

## [1.0.1] - 2026-09-11

### Fixed (from commits)

- **deps**: hold jsforce at 3.10.14 (da280ed)
- **deps**: bump lru-cache from 11.2.7 to 11.5.2 (#7) (eddf6dc)
- **deps**: bump jsforce from 3.10.14 to 3.10.25 (#6) (e77fc40)

## [1.0.0] - 2026-09-11

### Added

- The framework: `defineCli()`, `AciBaseCommand`, the init, prerun, and finally hooks, the embedded `Runtime`, the provider plugin API with native, contributed, and private tiers, and the `aclif` reference binary.
- Native providers: Salesforce, ServiceNow, DocuSign, Agentforce. Contributed provider: Google Workspace (Gmail, Calendar).
- Credential schemas per provider, profiles in `config.yaml` with `{env}`, `{file}`, and `{exec}` secret sources, a session cache with `auth status` and `auth logout`, and a policy file with static JWT identity.
- Tenant catalogue (`introspect --bootstrap`, `--refresh`, `--all`), declarative command manifests, and canonical alias sets with `--canonical`.
- Introspection on every command (`--schema`, `--examples`, `--shape`, `--changelog`, `--discover`, `--flags-for`, `--estimate`), a `version` command, and published JSON Schemas for the envelope, `aciMetadata`, tenant catalogues, manifests, and alias sets (contract 1.0.0).
- Test suite: unit, conformance, provider fixtures over msw, end-to-end binary, contract goldens, a fork simulation, and an opt-in live smoke.
- CLI scaffold (`aclif-scaffold-cli`) and provider scaffold (`scaffold-provider`).

### Added (from commits)

- aclif 1.0.0 (32473bd)
