import {describe, expect, it} from 'vitest'

import {
  credentialsFromSchema,
  describePaths,
  mergeValues,
  profileKey,
  validateCredentialSchema,
  valuesFromEnv,
  valuesFromFlags,
  valuesFromProfile,
  type CredentialSchema,
} from '../../src/core/provider/credential-schema.js'
import {flagsFromSchema} from '../../src/core/provider/flags.js'
import {ChainCredentialResolver, EnvCredentialResolver, ProfileCredentialResolver, StaticCredentialResolver} from '../../src/core/runtime/credential-resolver.js'
import {getRegistry} from '../../src/providers/index.js'

const schema: CredentialSchema = {
  fields: {
    instanceUrl: {flag: 'instance-url', env: 'T_URL', description: 'url'},
    accessToken: {flag: 'access-token', env: 'T_TOKEN', description: 'token', secret: true},
    username: {flag: 't-username', env: 'T_USER', description: 'user'},
    password: {flag: 't-password', env: 'T_PASS', description: 'pass', secret: true},
    securityToken: {env: 'T_SEC', description: 'env only'},
  },
  paths: [
    {authType: 'session', requires: ['instanceUrl', 'accessToken'], description: 'Token'},
    {authType: 'credentials', requires: ['instanceUrl', 'username', 'password'], optional: ['securityToken'], description: 'Password'},
  ],
  constants: {authServer: 'fixed.example.com'},
}

describe('U-CRED-1 credentialsFromSchema', () => {
  it('returns the first satisfied path with constants and optionals applied', () => {
    const r = credentialsFromSchema(schema, {instanceUrl: 'u', username: 'a', password: 'b', securityToken: 's'})
    expect(r?.path.authType).toBe('credentials')
    expect(r?.credentials).toEqual({instanceUrl: 'u', username: 'a', password: 'b', securityToken: 's', authServer: 'fixed.example.com', authType: 'credentials'})
  })

  it('prefers the earlier path when both are satisfied and ignores empty strings', () => {
    expect(credentialsFromSchema(schema, {instanceUrl: 'u', accessToken: 't', username: 'a', password: 'b'})?.path.authType).toBe('session')
    expect(credentialsFromSchema(schema, {instanceUrl: 'u', accessToken: ''})).toBeUndefined()
    expect(credentialsFromSchema(schema, {})).toBeUndefined()
  })

  it('reads values from env, flags, and profile keys, and merges by precedence', () => {
    expect(valuesFromEnv(schema, {T_URL: 'e', T_SEC: 'x', OTHER: 'y'})).toEqual({instanceUrl: 'e', securityToken: 'x'})
    expect(valuesFromFlags(schema, {'instance-url': 'f', 'access-token': 't', json: true})).toEqual({instanceUrl: 'f', accessToken: 't'})
    expect(profileKey('instanceUrl')).toBe('instance_url')
    expect(profileKey('dsAccountId')).toBe('ds_account_id')
    expect(valuesFromProfile(schema, {instance_url: 'p', security_token: 's'})).toEqual({instanceUrl: 'p', securityToken: 's'})
    expect(mergeValues({instanceUrl: 'flag'}, {instanceUrl: 'env', username: 'env-user'}, {username: 'profile'})).toEqual({instanceUrl: 'flag', username: 'env-user'})
  })

  it('describes paths by flag and env name and never by value', () => {
    const lines = describePaths(schema)
    expect(lines[0]).toBe('Token: --instance-url + --access-token (or T_URL, T_TOKEN)')
    expect(lines[1]).toBe('Password: --instance-url + --t-username + --t-password (or T_URL, T_USER, T_PASS)')
    expect(lines.join('\n')).not.toContain('secret')
  })

  it('generates env-bound flags only for fields that declare a flag', () => {
    const flags = flagsFromSchema(schema)
    expect(Object.keys(flags)).toEqual(['instance-url', 'access-token', 't-username', 't-password'])
  })

  it('validates structure', () => {
    expect(validateCredentialSchema(schema)).toEqual([])
    const bad: CredentialSchema = {
      fields: {instanceUrl: {flag: 'x', env: 'E', description: ''}, username: {flag: 'x', env: 'E', description: ''}},
      paths: [{authType: 'session', requires: ['accessToken'], description: ''}, {authType: 'session', requires: [], description: ''}],
    }
    const errors = validateCredentialSchema(bad)
    expect(errors.some((e) => e.includes('flag --x'))).toBe(true)
    expect(errors.some((e) => e.includes('env E'))).toBe(true)
    expect(errors.some((e) => e.includes('unknown field accessToken'))).toBe(true)
    expect(errors.some((e) => e.includes('requires nothing'))).toBe(true)
  })

  it('every built-in provider schema validates', () => {
    for (const {plugin} of getRegistry().entries()) expect(validateCredentialSchema(plugin.credentials), plugin.name).toEqual([])
  })
})

describe('U-CRED-2 resolvers', () => {
  const registry = getRegistry()

  it('env resolver resolves by schema and returns undefined for unknown or unconfigured providers', async () => {
    const r = new EnvCredentialResolver(registry, {SF_INSTANCE_URL: 'https://x', SF_ACCESS_TOKEN: 't'})
    expect(await r.get('salesforce')).toMatchObject({instanceUrl: 'https://x', accessToken: 't', authType: 'session'})
    expect(await r.get('servicenow')).toBeUndefined()
    expect(await r.get('nope')).toBeUndefined()
  })

  it('profile resolver resolves by snake_case keys and applies constants', async () => {
    const r = new ProfileCredentialResolver(registry, {google: {client_id: 'c', client_secret: 's', refresh_token: 'r'}})
    expect(await r.get('google')).toMatchObject({clientId: 'c', refreshToken: 'r', instanceUrl: 'https://www.googleapis.com', authType: 'oauth2'})
    expect(await r.get('salesforce')).toBeUndefined()
  })

  it('chain resolver returns the first hit in order', async () => {
    const a = new StaticCredentialResolver(new Map([['mautic', {instanceUrl: 'a', username: 'u', password: 'p', authType: 'credentials'}]]))
    const b = new EnvCredentialResolver(registry, {MAUTIC_BASE_URL: 'b', MAUTIC_API_USER: 'u', MAUTIC_API_PASSWORD: 'p', SN_INSTANCE_URL: 'https://sn', SN_ACCESS_TOKEN: 't'})
    const chain = new ChainCredentialResolver([a, b])
    expect((await chain.get('mautic'))?.instanceUrl).toBe('a')
    expect((await chain.get('servicenow'))?.instanceUrl).toBe('https://sn')
    expect(await chain.get('docusign')).toBeUndefined()
  })
})
