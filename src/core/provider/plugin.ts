// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * ProviderPlugin: everything the core needs to know about a provider.
 * See docs/PROVIDER_AUTHORING.md section 9.
 */
import type {Command} from '@oclif/core'

import type {AciError, AciMetadata, ProviderMetadata, ServiceAccountCredentials} from '../contract/aci.js'
import {validateCredentialSchema, type CredentialSchema} from './credential-schema.js'
import type {TenantWalk} from './tenant.js'
import type {HttpAdapter} from '../manifest/manifest.js'
import type {SessionSupport} from '../credentials/session-cache.js'

/** A command class as the registry sees it: an oclif command carrying ACI metadata. */
export type ProviderCommandClass = typeof Command & {aciMetadata: AciMetadata}

export interface ProviderPlugin<TClient = unknown> {
  /** Stable id: first argv token, credentials key, profile key. */
  name: string
  displayName: string
  description: string
  /** Handles or emails of the people who answer for this provider. Required for the contributed tier. */
  maintainers?: string[]
  /** Briefing surfaced by `learn` and `discover`. */
  metadata: ProviderMetadata
  /** Declarative auth. Drives flags, env, profiles, status, docs, and the no-credentials error. */
  credentials: CredentialSchema
  /** Build an authenticated client. Called through the ConnectionPool. */
  createClient(creds: ServiceAccountCredentials): Promise<TClient>
  destroyClient?(client: TClient): Promise<void>
  /** Override the pool cache key when identity is not username or delegated user. */
  cacheKey?(creds: ServiceAccountCredentials): string
  /** Map a thrown error to an AciError with provider hints; undefined means use the generic mapping. */
  classifyError?(error: unknown, context?: {query?: string}): AciError | undefined
  /**
   * Optional tenant walk: enumerate the live instance's customizations.
   * Read-only; run by `introspect --bootstrap` and by hosts, never as a side
   * effect of another command.
   */
  tenant?: TenantWalk<TClient>
  /**
   * Authenticated raw request against the instance, used by manifest
   * commands (docs/CONTRACT.md, Manifests). The manifest never handles auth, base URLs, or retries.
   */
  http?(client: TClient): HttpAdapter
  /** Opt into the standalone session cache: what state to keep and how to rebuild a client from it. */
  session?: SessionSupport<TClient>
  /** Cheap idempotent argv for the health probe, starting with the provider name. */
  healthProbe?: string[]
  /** Explicit command map: 'salesforce:data:query' → class. */
  commands: Record<string, ProviderCommandClass>
}

const NAME_RE = /^[a-z][a-z0-9-]*$/

/** Validate a plugin definition at import time and return it unchanged. */
export function defineProvider<TClient>(plugin: ProviderPlugin<TClient>): ProviderPlugin<TClient> {
  const errors: string[] = []
  if (!NAME_RE.test(plugin.name)) errors.push(`name '${plugin.name}' must match ${NAME_RE}`)
  if (!plugin.displayName) errors.push('displayName is required')
  if (plugin.metadata?.name !== plugin.name) errors.push(`metadata.name '${plugin.metadata?.name}' does not match '${plugin.name}'`)
  errors.push(...validateCredentialSchema(plugin.credentials).map((e) => `credentials: ${e}`))
  const ids = Object.keys(plugin.commands)
  if (ids.length === 0) errors.push('commands is empty')
  for (const id of ids) {
    if (!id.startsWith(`${plugin.name}:`)) errors.push(`command id '${id}' must start with '${plugin.name}:'`)
    const cls = plugin.commands[id]
    if (!cls || typeof cls !== 'function') errors.push(`command '${id}' is not a class`)
    else if (!cls.aciMetadata) errors.push(`command '${id}' has no aciMetadata`)
  }
  if (plugin.healthProbe) {
    const probeId = plugin.healthProbe.filter((a) => !a.startsWith('-')).join(':')
    const target = Object.keys(plugin.commands)
      .filter((id) => probeId === id || probeId.startsWith(`${id}:`))
      .sort((a, b) => b.length - a.length)[0]
    if (!target) errors.push(`healthProbe does not resolve to a registered command: ${plugin.healthProbe.join(' ')}`)
    else if (plugin.commands[target].aciMetadata.mutability !== 'read') errors.push(`healthProbe '${target}' is not a read command`)
  }
  if (errors.length) throw new Error(`Invalid provider plugin '${plugin.name}':\n  ${errors.join('\n  ')}`)
  // Bind each command class to its provider here rather than in the
  // provider's base class: the base cannot import plugin.ts, because
  // plugin.ts imports the command classes that extend the base.
  for (const cls of Object.values(plugin.commands)) (cls as {provider?: ProviderPlugin}).provider = plugin
  return plugin
}
