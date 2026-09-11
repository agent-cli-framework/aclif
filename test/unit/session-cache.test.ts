import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {FileSessionCache} from '../../src/cli/config/session-cache.js'
import {describeEntry, isExpired} from '../../src/core/credentials/session-cache.js'
import {docusignSession} from '../../src/providers/native/docusign/session.js'
import {salesforceSession} from '../../src/providers/native/salesforce/session.js'

describe('U-SESS-1 session cache', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aclif-sessions-'))
  })
  afterEach(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('round-trips, isolates keys, lists, clears by provider and entirely, at 0600', async () => {
    const cache = new FileSessionCache(dir)
    await cache.save('salesforce', 'k1', {state: {accessToken: 's1'}})
    await cache.save('salesforce', 'k2', {state: {accessToken: 's2'}})
    await cache.save('docusign', 'k1', {expiresAt: '2030-01-01T00:00:00Z', state: {accessToken: 'd'}})
    expect((await cache.load('salesforce', 'k1'))?.state).toEqual({accessToken: 's1'})
    expect(await cache.load('salesforce', 'k3')).toBeUndefined()
    expect((await cache.list()).map((e) => `${e.provider}/${e.instanceKey}`)).toEqual(['docusign/k1', 'salesforce/k1', 'salesforce/k2'])
    if (process.platform !== 'win32') expect((await stat(cache.path('salesforce', 'k1'))).mode & 0o777).toBe(0o600)
    expect(await cache.clear('salesforce', 'k1')).toBe(1)
    expect(await cache.clear('salesforce')).toBe(1)
    expect(await cache.clear()).toBe(1)
    expect(await cache.list()).toEqual([])
  })

  it('expiry uses a one-minute margin and a missing expiry never expires', () => {
    const now = Date.parse('2026-09-10T12:00:00Z')
    expect(isExpired({state: {}}, now)).toBe(false)
    expect(isExpired({expiresAt: '2026-09-10T12:05:00Z', state: {}}, now)).toBe(false)
    expect(isExpired({expiresAt: '2026-09-10T12:00:30Z', state: {}}, now)).toBe(true)
    expect(isExpired({expiresAt: 'garbage', state: {}}, now)).toBe(true)
  })

  it('describeEntry exposes key names, never values', () => {
    const d = describeEntry({provider: 'salesforce', instanceKey: 'abcdefghijklmnop', savedAt: 't', state: {accessToken: 'SECRET'}})
    expect(JSON.stringify(d)).not.toContain('SECRET')
    expect(d.stateKeys).toEqual(['accessToken'])
    expect(d.instanceKey).toBe('abcdefghijkl…')
  })

  it('Salesforce session support saves the session id and instance URL and restores without a login', async () => {
    expect(salesforceSession.save({accessToken: undefined, instanceUrl: 'https://x'} as never)).toBeUndefined()
    const snap = salesforceSession.save({accessToken: 'SID', instanceUrl: 'https://na1.example.com'} as never)!
    expect(snap.state).toEqual({accessToken: 'SID', instanceUrl: 'https://na1.example.com'})
    const conn = await salesforceSession.restore({instanceUrl: 'https://login.example.com', username: 'u', password: 'p', authType: 'credentials'}, snap)
    expect(conn.accessToken).toBe('SID')
    expect(conn.instanceUrl).toBe('https://na1.example.com')
    await expect(salesforceSession.restore({instanceUrl: 'x', authType: 'session'}, {state: {}})).rejects.toThrow(/incomplete/)
  })

  it('DocuSign session support keeps the access token with expiry and never the private key', async () => {
    const creds = {instanceUrl: '', integrationKey: 'ik', impersonatedUserId: 'uid', dsAccountId: 'acct', privateKey: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', authType: 'jwt-grant' as const}
    const client = await docusignSession.restore(creds, {expiresAt: '2030-01-01T00:00:00Z', state: {accessToken: 'AT', expiresAt: 1_900_000_000}})
    const snap = docusignSession.save(client)!
    expect(snap.state).toEqual({accessToken: 'AT', expiresAt: 1_900_000_000})
    expect(snap.expiresAt).toBe(new Date(1_900_000_000 * 1000).toISOString())
    expect(JSON.stringify(snap)).not.toContain('PRIVATE KEY')
  })
})
