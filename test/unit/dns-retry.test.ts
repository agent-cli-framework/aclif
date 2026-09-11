import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {isTransientDnsError, withDnsRetry} from '../../src/util/dns-retry.js'

/** U-DNS-1. */
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const coded = (code: string) => Object.assign(new Error(`getaddrinfo ${code} host`), {code})

describe('U-DNS-1 withDnsRetry', () => {
  it('retries EAI_AGAIN and ENOTFOUND up to three attempts and then throws the last error', async () => {
    const op = vi.fn().mockRejectedValueOnce(coded('EAI_AGAIN')).mockRejectedValueOnce(coded('ENOTFOUND')).mockResolvedValue('ok')
    const p = withDnsRetry(op)
    await vi.runAllTimersAsync()
    expect(await p).toBe('ok')
    expect(op).toHaveBeenCalledTimes(3)

    const always = vi.fn().mockRejectedValue(coded('EAI_AGAIN'))
    const failing = withDnsRetry(always)
    const settled = failing.catch((e: Error) => e)
    await vi.runAllTimersAsync()
    expect(await settled).toMatchObject({code: 'EAI_AGAIN'})
    expect(always).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-DNS errors', async () => {
    const op = vi.fn().mockRejectedValue(new Error('Request failed (401)'))
    await expect(withDnsRetry(op)).rejects.toThrow(/401/)
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('detects a transient code nested in cause, and by message', () => {
    expect(isTransientDnsError(new Error('fetch failed', {cause: coded('ENOTFOUND')}))).toBe(true)
    expect(isTransientDnsError(new Error('fetch failed', {cause: new Error('x', {cause: coded('ETIMEDOUT')})}))).toBe(true)
    expect(isTransientDnsError(new Error('getaddrinfo EAI_AGAIN api.example.com'))).toBe(true)
    expect(isTransientDnsError(new Error('boom'))).toBe(false)
    expect(isTransientDnsError('plain ENOTFOUND string')).toBe(true)
    const cyclic = new Error('loop') as Error & {cause: unknown}
    cyclic.cause = cyclic
    expect(isTransientDnsError(cyclic)).toBe(false)
  })
})
