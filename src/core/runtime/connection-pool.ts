// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * ConnectionPool: a host-owned LRU cache of authenticated provider connections.
 *
 * Replaces the module-global LRU caches in lib/salesforce/connection.ts and
 * lib/servicenow/connection.ts. The standalone CLI binary creates one of these
 * at startup; the gateway runtime creates one at startup. Either way, warm
 * connections are reused across command invocations.
 *
 * The pool deduplicates in-flight logins: if two concurrent invocations both
 * ask for the same uncached credential, only one login round-trip happens and
 * both invocations receive the same Connection.
 */

import {LRUCache} from 'lru-cache'

import {instanceKey} from '../provider/tenant.js'

import type {ServiceAccountCredentials} from '../contract/aci.js'

export interface PoolStats {
  size: number
  maxSize: number
  entries: Array<{
    provider: string
    age: number
    hits: number
  }>
}

interface PoolEntry {
  provider: string
  connection: unknown
  createdAt: number
  hits: number
  destroy?: () => Promise<void>
}

/**
 * Provider-specific connection factory and disposer.
 * Each provider plugin (Salesforce, ServiceNow, etc.) registers a factory.
 */
export interface ConnectionFactory {
  /** Build a brand-new authenticated connection */
  create(creds: ServiceAccountCredentials): Promise<unknown>
  /** Tear down a connection on cache eviction (e.g., logout) */
  destroy?(connection: unknown): Promise<void>
  /** Override the cache key when identity is not username, delegated user, or client id. */
  cacheKey?(creds: ServiceAccountCredentials): string
}

export interface ConnectionPoolOptions {
  /** Max number of cached connections (default: 100) */
  max?: number
  /** TTL in milliseconds (default: 30 minutes) */
  ttl?: number
}

export class ConnectionPool {
  private cache: LRUCache<string, PoolEntry>
  private factories = new Map<string, ConnectionFactory>()
  private inFlight = new Map<string, Promise<unknown>>()

  constructor(opts: ConnectionPoolOptions = {}) {
    this.cache = new LRUCache<string, PoolEntry>({
      max: opts.max ?? 100,
      ttl: opts.ttl ?? 30 * 60 * 1000,
      dispose: (entry) => {
        // Best-effort async cleanup; we don't await because LRUCache.dispose
        // is sync. Errors are swallowed (e.g., logout failures on eviction).
        if (entry.destroy) {
          Promise.resolve(entry.destroy()).catch(() => {
            // Intentionally ignored
          })
        }
      },
    })
  }

  /**
   * Register a provider's connection factory. Called once at runtime startup
   * for each provider plugin.
   */
  registerFactory(provider: string, factory: ConnectionFactory): void {
    this.factories.set(provider, factory)
  }

  /** A pooled connection for these credentials, if one is live. */
  get<T = unknown>(provider: string, creds: ServiceAccountCredentials): T | undefined {
    const cached = this.cache.get(this.cacheKey(provider, creds))
    if (!cached) return undefined
    cached.hits++
    return cached.connection as T
  }

  /** Seed the cache with a connection built elsewhere (a restored session). */
  put(provider: string, creds: ServiceAccountCredentials, connection: unknown, destroy?: () => Promise<void>): void {
    this.cache.set(this.cacheKey(provider, creds), {provider, connection, createdAt: Date.now(), hits: 0, destroy})
  }

  /**
   * Return true if a factory is registered for this provider.
   */
  hasFactory(provider: string): boolean {
    return this.factories.has(provider)
  }

  /**
   * Get or create a connection for the given provider + credentials.
   *
   * - Cache hit: returns the warm Connection synchronously (after the await).
   * - In-flight login: awaits the existing login and returns its result.
   * - Cache miss: creates a new connection, caches it, and returns it.
   */
  async getOrCreate<T = unknown>(provider: string, creds: ServiceAccountCredentials): Promise<T> {
    const factory = this.factories.get(provider)
    if (!factory) {
      throw new Error(`No connection factory registered for provider: ${provider}`)
    }

    const key = this.cacheKey(provider, creds)
    const cached = this.cache.get(key)
    if (cached) {
      cached.hits++
      return cached.connection as T
    }

    // Deduplicate concurrent logins for the same key
    const existing = this.inFlight.get(key)
    if (existing) {
      return existing as Promise<T>
    }

    const promise = (async () => {
      const connection = await factory.create(creds)
      this.cache.set(key, {
        provider,
        connection,
        createdAt: Date.now(),
        hits: 1,
        destroy: factory.destroy ? () => factory.destroy!(connection) : undefined,
      })
      return connection
    })()

    this.inFlight.set(key, promise)
    try {
      return (await promise) as T
    } finally {
      this.inFlight.delete(key)
    }
  }

  /**
   * Evict an entry by provider + credentials (e.g., after auth rotation).
   */
  async evict(provider: string, creds: ServiceAccountCredentials): Promise<void> {
    const key = this.cacheKey(provider, creds)
    this.cache.delete(key)
  }

  /**
   * Clear the entire pool.
   */
  async clear(): Promise<void> {
    this.cache.clear()
    this.inFlight.clear()
  }

  /**
   * Operational stats for /api/pool/stats endpoint.
   */
  stats(): PoolStats {
    const now = Date.now()
    const entries: PoolStats['entries'] = []
    for (const entry of this.cache.values()) {
      entries.push({
        provider: entry.provider,
        age: now - entry.createdAt,
        hits: entry.hits,
      })
    }
    return {
      size: this.cache.size,
      maxSize: this.cache.max as number,
      entries,
    }
  }

  /** Same key the tenant cache uses, so catalogue and connection agree on what an instance is. */
  private cacheKey(provider: string, creds: ServiceAccountCredentials): string {
    const override = this.factories.get(provider)?.cacheKey
    return override ? `${provider}:${override(creds)}` : instanceKey(provider, creds)
  }
}
