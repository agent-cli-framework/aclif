// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Session cache: reusable session state a provider marks as safe to keep
 * (a Salesforce session id, a DocuSign access token) so a standalone run
 * does not log in on every command. Keyed by the same instance key as the
 * connection pool and the tenant cache. Stores session state, never the
 * credential that produced it. See docs/CONFIGURATION.md, Sessions.
 */
import type {ServiceAccountCredentials} from '../contract/aci.js'

export interface SessionSnapshot {
  /** ISO time after which the state is useless; absent means "until rejected". */
  expiresAt?: string
  state: Record<string, unknown>
}

export interface SessionEntry extends SessionSnapshot {
  provider: string
  instanceKey: string
  savedAt: string
}

export interface SessionCache {
  load(provider: string, instanceKey: string): Promise<SessionEntry | undefined>
  save(provider: string, instanceKey: string, snapshot: SessionSnapshot): Promise<void>
  /** Remove entries; all providers when none given. Returns how many were removed. */
  clear(provider?: string, instanceKey?: string): Promise<number>
  list(): Promise<SessionEntry[]>
}

/** What a provider plugin implements to opt in. */
export interface SessionSupport<TClient = unknown> {
  /** Extract reusable state from a live client, or undefined when there is none yet. */
  save(client: TClient): SessionSnapshot | undefined
  /** Rebuild a client from credentials plus saved state, without logging in. */
  restore(creds: ServiceAccountCredentials, snapshot: SessionSnapshot): Promise<TClient>
}

export function isExpired(entry: SessionSnapshot, nowMs = Date.now()): boolean {
  if (!entry.expiresAt) return false
  const t = Date.parse(entry.expiresAt)
  return Number.isNaN(t) || nowMs >= t - 60_000
}

/** Secret-free view for `auth status`. */
export function describeEntry(e: SessionEntry): {provider: string; instanceKey: string; savedAt: string; expiresAt: string | null; stateKeys: string[]} {
  return {provider: e.provider, instanceKey: `${e.instanceKey.slice(0, 12)}…`, savedAt: e.savedAt, expiresAt: e.expiresAt ?? null, stateKeys: Object.keys(e.state)}
}
