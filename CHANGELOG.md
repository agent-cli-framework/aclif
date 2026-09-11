# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); release headings are written by the release workflow from Conventional Commit messages. Contract changes name the `CONTRACT_VERSION` they move to.

## Unreleased

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
