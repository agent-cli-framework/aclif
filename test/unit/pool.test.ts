import {describe, expect, it, vi} from 'vitest'

import type {ServiceAccountCredentials} from '../../src/core/contract/aci.js'
import {ConnectionPool} from '../../src/core/runtime/connection-pool.js'

/** U-POOL-1 and U-POOL-2. */
const creds = (over: Partial<ServiceAccountCredentials> = {}): ServiceAccountCredentials => ({instanceUrl: 'https://a.example.com', username: 'u', authType: 'credentials', ...over})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('U-POOL-1 ConnectionPool', () => {
  it('creates once, counts hits, and dedupes concurrent creation for one key', async () => {
    const pool = new ConnectionPool()
    const create = vi.fn(async (c: ServiceAccountCredentials) => {
      await sleep(5)
      return {conn: c.instanceUrl}
    })
    pool.registerFactory('acme', {create})
    const [a, b] = await Promise.all([pool.getOrCreate('acme', creds()), pool.getOrCreate('acme', creds())])
    expect(a).toBe(b)
    expect(create).toHaveBeenCalledTimes(1)
    await pool.getOrCreate('acme', creds())
    expect(pool.stats()).toMatchObject({size: 1, entries: [{provider: 'acme', hits: 2}]})
    expect(pool.hasFactory('acme')).toBe(true)
    expect(pool.hasFactory('other')).toBe(false)
  })

  it('throws for an unknown provider', async () => {
    await expect(new ConnectionPool().getOrCreate('nope', creds())).rejects.toThrow(/No connection factory registered for provider: nope/)
  })

  it('evicts on TTL and calls destroy; evict() and clear() drop entries', async () => {
    const destroy = vi.fn(async () => {})
    const pool = new ConnectionPool({ttl: 20})
    pool.registerFactory('acme', {create: async () => ({}), destroy})
    const first = await pool.getOrCreate('acme', creds())
    await sleep(35)
    const second = await pool.getOrCreate('acme', creds())
    expect(second).not.toBe(first)
    expect(destroy).toHaveBeenCalledTimes(1)
    await pool.evict('acme', creds())
    expect(pool.stats().size).toBe(0)
    expect(destroy).toHaveBeenCalledTimes(2)
    pool.put('acme', creds({username: 'seeded'}), {seeded: true}, async () => destroy())
    expect(await pool.getOrCreate('acme', creds({username: 'seeded'}))).toEqual({seeded: true})
    await pool.clear()
    expect(pool.stats().size).toBe(0)
    expect(destroy).toHaveBeenCalledTimes(3)
  })
})

describe('U-POOL-2 cache key', () => {
  it('separates instanceUrl, identity, and authType; honours a plugin cacheKey override', async () => {
    const pool = new ConnectionPool()
    let n = 0
    pool.registerFactory('acme', {create: async () => ({n: ++n})})
    const base = await pool.getOrCreate<{n: number}>('acme', creds())
    expect(await pool.getOrCreate('acme', creds())).toBe(base)
    expect(await pool.getOrCreate('acme', creds({instanceUrl: 'https://b.example.com'}))).not.toBe(base)
    expect(await pool.getOrCreate('acme', creds({username: 'other'}))).not.toBe(base)
    expect(await pool.getOrCreate('acme', creds({authType: 'session', accessToken: 't'}))).not.toBe(base)
    expect(await pool.getOrCreate('acme', creds({username: undefined, clientId: 'c1'}))).not.toBe(base)
    expect(await pool.getOrCreate('acme', creds({username: undefined, delegatedUser: 'd@x'}))).not.toBe(base)
    expect(pool.stats().size).toBe(6)

    const custom = new ConnectionPool()
    let m = 0
    custom.registerFactory('acme', {create: async () => ({m: ++m}), cacheKey: (c) => c.instanceUrl})
    const one = await custom.getOrCreate('acme', creds())
    expect(await custom.getOrCreate('acme', creds({username: 'someone-else', authType: 'session'}))).toBe(one)
    expect(await custom.getOrCreate('acme', creds({instanceUrl: 'https://b.example.com'}))).not.toBe(one)
  })
})
