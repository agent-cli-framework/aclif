// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * ProviderRegistry: the set of providers this build knows about, with the
 * tier each came from. Tier is derived from the directory the plugin lives
 * in, never declared by the plugin (docs/FORKING.md).
 */
import type {ProviderCommandClass, ProviderPlugin} from './plugin.js'

export type ProviderTier = 'native' | 'contributed' | 'private'
export const PROVIDER_TIERS: ProviderTier[] = ['native', 'contributed', 'private']

export interface ProviderEntry {
  plugin: ProviderPlugin
  tier: ProviderTier
}

export class ProviderRegistry {
  private readonly byName = new Map<string, ProviderEntry>()
  private readonly commandIndex = new Map<string, string>()

  constructor(entries: ProviderEntry[] = []) {
    for (const e of entries) this.register(e)
  }

  register(entry: ProviderEntry): void {
    const {plugin, tier} = entry
    const existing = this.byName.get(plugin.name)
    if (existing) {
      throw new Error(`Provider '${plugin.name}' registered twice (tiers: ${existing.tier}, ${tier}). Rename or exclude one.`)
    }
    if (tier === 'contributed' && !(plugin.maintainers && plugin.maintainers.length)) {
      throw new Error(`Provider '${plugin.name}' is in the contributed tier and must declare maintainers`)
    }
    for (const id of Object.keys(plugin.commands)) {
      const owner = this.commandIndex.get(id)
      if (owner) throw new Error(`Command id '${id}' declared by both '${owner}' and '${plugin.name}'`)
    }
    this.byName.set(plugin.name, entry)
    for (const id of Object.keys(plugin.commands)) this.commandIndex.set(id, plugin.name)
  }

  entries(): ProviderEntry[] {
    return [...this.byName.values()]
  }

  names(): string[] {
    return [...this.byName.keys()]
  }

  get(name: string): ProviderEntry | undefined {
    return this.byName.get(name)
  }

  plugin(name: string): ProviderPlugin | undefined {
    return this.byName.get(name)?.plugin
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }

  /** Every provider command, id → class, for the explicit oclif strategy. */
  commands(): Record<string, ProviderCommandClass> {
    const out: Record<string, ProviderCommandClass> = {}
    for (const {plugin} of this.byName.values()) Object.assign(out, plugin.commands)
    return out
  }

  /** Provider that owns a command id, if any. */
  ownerOf(commandId: string): string | undefined {
    return this.commandIndex.get(commandId)
  }
}

// ── The active registry ──────────────────────────────────────────
//
// A CLI built on this framework declares its provider set with
// defineCli(), which makes that registry the active one. Core commands,
// the runtime, and the hooks all read it from here, so they serve
// whichever CLI loaded them. The framework's own reference binary is
// just one such CLI. A fallback (the framework's built-in providers) is
// registered by src/providers/index.ts for code that runs without a CLI,
// such as unit tests.

let active: ProviderRegistry | undefined
let fallback: (() => ProviderRegistry) | undefined

export function setActiveRegistry(registry: ProviderRegistry): void {
  active = registry
}

export function getActiveRegistry(): ProviderRegistry | undefined {
  return active
}

export function registerFallbackRegistry(factory: () => ProviderRegistry): void {
  fallback = factory
}

/** The registry in force: the defined CLI's, else the framework's built-in providers. */
export function getRegistry(): ProviderRegistry {
  if (active) return active
  if (fallback) {
    active = fallback()
    return active
  }
  throw new Error('No provider registry: call defineCli() in the command target module, or import aclif/providers')
}
