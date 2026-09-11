// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * defineCli(): what a CLI built on this framework calls from its oclif
 * command target module. It names the CLI, picks the providers, and
 * returns the command catalogue oclif loads. The framework's reference
 * binary calls it too (src/commands-index.ts), so there is one path.
 *
 *   // src/index.ts of the mycli package
 *   import {defineCli} from 'aclif'
 *   import {salesforcePlugin, servicenowPlugin} from 'aclif/providers'
 *   import {mauticPlugin} from './providers/mautic/plugin.js'
 *   export const {COMMANDS, registry} = defineCli({
 *     bin: 'mycli',
 *     providers: [salesforcePlugin, servicenowPlugin, mauticPlugin],
 *   })
 */
import type {Command} from '@oclif/core'

import type {ProviderPlugin} from '../core/provider/plugin.js'
import {ProviderRegistry, setActiveRegistry, type ProviderEntry, type ProviderTier} from '../core/provider/registry.js'
import {manifestCommand} from '../core/manifest/manifest-command.js'
import {loadStandaloneManifestsSync} from './config/manifest-store.js'
import {standaloneConfigDir} from './config/paths.js'
import {profileNameFromArgv} from './context.js'
import {applyScopedEnv} from './env.js'
import AliasesExport from './commands/aliases/export.js'
import AliasesImport from './commands/aliases/import.js'
import AliasesList from './commands/aliases/list.js'
import AliasesResolve from './commands/aliases/resolve.js'
import AliasesValidate from './commands/aliases/validate.js'
import AuthLogout from './commands/auth/logout.js'
import AuthStatus from './commands/auth/status.js'
import Discover from './commands/discover.js'
import Learn from './commands/learn.js'
import Version from './commands/version.js'
import ManifestsList from './commands/manifests/list.js'
import ManifestsValidate from './commands/manifests/validate.js'

export type CommandClass = typeof Command

/** The provider-agnostic commands every CLI gets unless it opts out. */
export const CORE_COMMANDS: Record<string, CommandClass> = {
  discover: Discover as unknown as CommandClass,
  learn: Learn as unknown as CommandClass,
  version: Version as unknown as CommandClass,
  'aliases:list': AliasesList as unknown as CommandClass,
  'aliases:resolve': AliasesResolve as unknown as CommandClass,
  'aliases:validate': AliasesValidate as unknown as CommandClass,
  'aliases:import': AliasesImport as unknown as CommandClass,
  'aliases:export': AliasesExport as unknown as CommandClass,
  'auth:status': AuthStatus as unknown as CommandClass,
  'auth:logout': AuthLogout as unknown as CommandClass,
  'manifests:validate': ManifestsValidate as unknown as CommandClass,
  'manifests:list': ManifestsList as unknown as CommandClass,
}

export interface CliDefinition {
  /** The binary name; must equal oclif.bin in the CLI package's package.json. */
  bin: string
  /** Config directory name; defaults to bin (oclif.dirname). */
  dirname?: string
  /** Plugins, or {plugin, tier} entries. A bare plugin is tier 'private': it belongs to this CLI. */
  providers: Array<ProviderPlugin | ProviderEntry>
  /** Include discover, learn, aliases, auth, manifests. Default true. */
  coreCommands?: boolean
  /** Load the `manifests:` section of the CLI's config.yaml at catalogue build. Default true. */
  manifests?: boolean
  /** Extra commands of the CLI's own, keyed by id. */
  commands?: Record<string, CommandClass>
  /** Tier assigned to bare plugins. Default 'private'. */
  defaultTier?: ProviderTier
}

export interface DefinedCli {
  COMMANDS: Record<string, CommandClass>
  registry: ProviderRegistry
  bin: string
  dirname: string
}

let current: DefinedCli | undefined

/** The CLI defined in this process, if any. */
export function currentCli(): DefinedCli | undefined {
  return current
}

function isEntry(p: ProviderPlugin | ProviderEntry): p is ProviderEntry {
  return typeof (p as ProviderEntry).tier === 'string' && typeof (p as ProviderEntry).plugin === 'object'
}

function standaloneManifestCommands(registry: ProviderRegistry, bin: string, dirname: string, taken: Set<string>): Record<string, CommandClass> {
  const out: Record<string, CommandClass> = {}
  if (process.env.ACLIF_NO_MANIFESTS === '1') return out
  const warn = (m: string) => process.stderr.write(`Warning: ${m}\n`)
  const configDir = standaloneConfigDir(bin, dirname)
  const byProvider = loadStandaloneManifestsSync(configDir, profileNameFromArgv(process.argv.slice(2)), warn)
  for (const [provider, list] of Object.entries(byProvider)) {
    const plugin = registry.plugin(provider)
    if (!plugin) {
      warn(`Manifests listed for unknown provider '${provider}' ignored`)
      continue
    }
    for (const {manifest, file} of list) {
      if (taken.has(manifest.id) || out[manifest.id]) {
        warn(`Manifest ${file}: id '${manifest.id}' collides with an existing command; skipped`)
        continue
      }
      try {
        out[manifest.id] = manifestCommand(manifest, plugin) as unknown as CommandClass
      } catch (err) {
        warn(`Skipping manifest ${file}: ${(err as Error).message}`)
      }
    }
  }
  return out
}

export function defineCli(def: CliDefinition): DefinedCli {
  const bin = def.bin
  if (!/^[a-z][a-z0-9-]*$/.test(bin)) throw new Error(`defineCli: bin '${bin}' must be lower-case letters, digits, and dashes`)
  const dirname = def.dirname ?? bin
  applyScopedEnv(bin)

  const entries: ProviderEntry[] = def.providers.map((p) => (isEntry(p) ? p : {plugin: p, tier: def.defaultTier ?? 'private'}))
  const registry = new ProviderRegistry(entries)
  setActiveRegistry(registry)

  const COMMANDS: Record<string, CommandClass> = {
    ...(def.coreCommands === false ? {} : CORE_COMMANDS),
    ...(registry.commands() as unknown as Record<string, CommandClass>),
    ...(def.commands ?? {}),
  }
  if (def.manifests !== false) Object.assign(COMMANDS, standaloneManifestCommands(registry, bin, dirname, new Set(Object.keys(COMMANDS))))

  current = {COMMANDS, registry, bin, dirname}
  return current
}
