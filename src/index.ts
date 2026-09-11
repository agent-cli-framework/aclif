// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
export {AciBaseCommand} from './cli/base-command.js'
export * from './core/identity/index.js'
export * from './core/policy/policy.js'
export * from './core/provider/credential-schema.js'
export {flagsFromSchema} from './core/provider/flags.js'
export {defineProvider, type ProviderCommandClass, type ProviderPlugin} from './core/provider/plugin.js'
export {getRegistry, PROVIDER_TIERS, ProviderRegistry, type ProviderEntry, type ProviderTier} from './core/provider/registry.js'
export * from './providers/index.js'
export {CORE_COMMANDS, currentCli, defineCli, type CliDefinition, type DefinedCli} from './cli/define-cli.js'
export {applyScopedEnv, envScope, scopedEnvName, SCOPED_SUFFIXES} from './cli/env.js'
export {getActiveRegistry, setActiveRegistry} from './core/provider/registry.js'

import {builtinRegistry as registryForMetadata} from './providers/index.js'
import type {ProviderMetadata} from './core/contract/aci.js'
/** Provider metadata keyed by name, derived from the registry. */
export const providers: Record<string, ProviderMetadata> = Object.fromEntries(
  registryForMetadata().entries().map((e) => [e.plugin.name, e.plugin.metadata]),
)
export * from './core/provider/tenant.js'
export {FileTenantCache} from './cli/config/tenant-cache.js'
export * from './core/credentials/secret-source.js'
export * from './core/credentials/session-cache.js'
export {FileSessionCache} from './cli/config/session-cache.js'
export * from './core/alias/alias-set.js'
export {FileAliasStore, loadAliasSetFileSync, loadStandaloneAliasSetsSync, STARTER_VOCABULARY} from './cli/config/alias-store.js'
export * from './core/manifest/manifest.js'
export {manifestCommand} from './core/manifest/manifest-command.js'
export {FileManifestStore, loadManifestFileSync, loadStandaloneManifestsSync} from './cli/config/manifest-store.js'
export {COMMAND_CONTEXT_KEY, getCommandContext, setCommandContext, type CommandContext} from './core/command-context.js'
export {ConfigError, loadConfigFile, resolvePolicy, selectProfile, applyProfileToEnv, type ConfigFile, type Profile} from './cli/config/profiles.js'
export {discoverSchema, apiNameToCommandName, fieldsToFlags} from './providers/native/salesforce/discovery.js'
export {streamSalesforceContentVersion} from './providers/native/salesforce/client.js'
export * from './core/contract/aci.js'
export {CONTRACT_VERSION} from './core/contract/version.js'

// Embedded runtime exports, used by hosts that embed the CLI in their own
// process. The standalone binary at bin/run.js does not use
// these; it goes through oclif's normal execute() flow.
export * from './core/runtime/index.js'
