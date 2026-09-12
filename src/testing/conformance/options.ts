// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {existsSync, readdirSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {it} from 'vitest'

import type {AciBaseCommand} from '../../cli/base-command.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../core/contract/aci.js'
import type {ProviderPlugin} from '../../core/provider/plugin.js'
import type {ProviderEntry, ProviderRegistry, ProviderTier} from '../../core/provider/registry.js'

/** A directory whose immediate subdirectories are providers of one tier. */
export interface SourceDir {
  dir: string
  tier: ProviderTier
}

/** A client double whose member accesses are recorded, for the tenant-walk rules. */
export interface RecordingFake {
  client: unknown
  calls: string[]
}

export interface ConformanceOptions {
  /** The registry to iterate, usually the CLI's `registry` export. */
  registry: ProviderRegistry
  /** Package root of the CLI under test: where oclif loads package.json and lib/. */
  cliRoot: string
  /**
   * Where provider source lives. The suite checks only providers whose
   * directory is found here, so a CLI that imports framework providers
   * checks its own providers and trusts the framework's.
   */
  sourceDirs: SourceDir[]
  /** JSON file `{packages: {name: reason}}` naming every third-party package a provider may import. */
  dependencyAllowlist: string
  /** A second allowlist that private-tier providers may extend the first with. */
  privateDependencyAllowlist?: string
  /** Path of a provider's setup document. Default: `docs/providers/<tier>/<name>/SETUP.md` in the framework, `docs/providers/<name>/SETUP.md` elsewhere. */
  setupDoc?: (name: string, tier: ProviderTier) => string
  /** CODEOWNERS path; when given, contributed providers must declare maintainers matching their line. */
  codeowners?: string
  /** Directory of manifest fixture JSON files for C-MAN-2; skipped when absent. */
  manifestFixtures?: string
  /**
   * Set only when the suite runs inside the framework repository: the
   * framework's `src/` directory. Enables the rules about the framework's
   * own layout (tiered provider directories, core and cli import
   * boundaries) and lets provider source import `core/`, `util/`, and the
   * base command by relative path.
   */
  frameworkSrc?: string
  /** The framework's eslint config, for asserting the import-boundary zones are still declared. */
  eslintConfig?: unknown
  /** Commands that need no client and so answer without credentials by design, with the reason. */
  noClient?: Record<string, string>
  /** Per provider: a recording fake client for its tenant walk, and the read-only members it may touch. */
  tenantFakes?: Record<string, () => RecordingFake>
  readOnlyMembers?: Record<string, string[]>
  /**
   * A fake client for a provider's http adapter, with its request calls
   * recorded, for the http adapter rules. Called with the provider name;
   * return undefined for a provider you have no fake for and the suite says so.
   */
  httpFakes?: (provider: string) => {client: Record<string, unknown>; requests: unknown[][]} | undefined
  /** Per provider: a client with a live session and one without, for the session snapshot rules. */
  sessionFakes?: Record<string, {live: () => unknown; fresh: () => unknown}>
}

export type Cmd = typeof AciBaseCommand & {
  aciMetadata: AciMetadata
  responseShape?: ResponseShape | null
  aciExamples?: CommandExample[]
  dryRunMode?: 'local' | 'server'
  flags?: Record<string, Record<string, unknown>>
  args?: Record<string, Record<string, unknown>>
}

export interface CommandRow {
  id: string
  cls: Cmd
  plugin: ProviderPlugin
  tier: ProviderTier
}

/** Provider directory names present under the source directories. */
export function ownProviderNames(opts: ConformanceOptions): Set<string> {
  const names = new Set<string>()
  for (const {dir} of opts.sourceDirs) {
    const abs = join(opts.cliRoot, dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) {
      if (statSync(join(abs, name)).isDirectory() && existsSync(join(abs, name, 'plugin.ts'))) names.add(name)
    }
  }
  return names
}

/** Registry entries whose provider source is under the source directories. */
export function ownEntries(opts: ConformanceOptions): ProviderEntry[] {
  const own = ownProviderNames(opts)
  return opts.registry.entries().filter((e) => own.has(e.plugin.name))
}

export function commandRows(entries: ProviderEntry[]): CommandRow[] {
  return entries.flatMap(({plugin, tier}) => Object.entries(plugin.commands).map(([id, cls]) => ({id, cls: cls as unknown as Cmd, plugin, tier})))
}

export function setupDocPath(opts: ConformanceOptions, name: string, tier: ProviderTier): string {
  if (opts.setupDoc) return opts.setupDoc(name, tier)
  return opts.frameworkSrc ? join(opts.cliRoot, 'docs', 'providers', tier, name, 'SETUP.md') : join(opts.cliRoot, 'docs', 'providers', name, 'SETUP.md')
}

/** `it.each` that registers one skipped test instead of nothing when there are no rows. */
export function eachRow<T>(rows: T[], name: string, fn: (row: T) => void | Promise<void>, timeout?: number): void {
  if (rows.length === 0) {
    it.skip(`${name} (no providers of its own to check)`, () => undefined)
    return
  }
  for (const row of rows) {
    const label = name.replace('%s', String((row as {id?: string; plugin?: {name: string}}).id ?? (row as {plugin?: {name: string}}).plugin?.name ?? row))
    it(label, () => fn(row), timeout)
  }
}
