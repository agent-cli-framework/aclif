import {describe, expect, it} from 'vitest'

import {
  AnonymousIdentityProvider,
  createIdentityProvider,
  IdentityError,
  type IdentityProvider,
  signHs256,
  StaticJwtIdentityProvider,
  tokenFromArgv,
  verifyHs256,
} from '../../src/core/identity/index.js'

const SECRET = 'test-secret'

describe('U-ID-1 identity providers', () => {
  it('anonymous resolves nothing', async () => {
    const provider: IdentityProvider = new AnonymousIdentityProvider()
    expect(await provider.resolve({argv: ['--identity-token', 'x'], env: {}})).toBeUndefined()
  })

  it('static-jwt resolves nothing when no token is presented', async () => {
    expect(await new StaticJwtIdentityProvider().resolve({argv: [], env: {ACLIF_IDENTITY_SECRET: SECRET}})).toBeUndefined()
  })

  it('static-jwt verifies a token from the environment and maps claims', async () => {
    const token = signHs256({sub: 'alice', email: 'alice@example.com', name: 'Alice', org_id: 'acme'}, SECRET)
    const id = await new StaticJwtIdentityProvider().resolve({argv: [], env: {ACLIF_IDENTITY_TOKEN: token, ACLIF_IDENTITY_SECRET: SECRET}})
    expect(id).toMatchObject({id: 'alice', email: 'alice@example.com', displayName: 'Alice', orgId: 'acme'})
    expect(id?.claims?.sub).toBe('alice')
  })

  it('static-jwt takes the token from argv ahead of the environment', async () => {
    const good = signHs256({sub: 'argv-user'}, SECRET)
    const other = signHs256({sub: 'env-user'}, SECRET)
    const id = await new StaticJwtIdentityProvider().resolve({
      argv: ['salesforce', 'data', 'query', '--identity-token', good],
      env: {ACLIF_IDENTITY_TOKEN: other, ACLIF_IDENTITY_SECRET: SECRET},
    })
    expect(id?.id).toBe('argv-user')
    expect(tokenFromArgv(['--identity-token=abc'])).toBe('abc')
  })

  it('static-jwt rejects a tampered token', async () => {
    const token = signHs256({sub: 'alice'}, SECRET)
    const tampered = token.replace(/\.[^.]+$/, '.AAAA')
    await expect(
      new StaticJwtIdentityProvider().resolve({argv: [], env: {ACLIF_IDENTITY_TOKEN: tampered, ACLIF_IDENTITY_SECRET: SECRET}}),
    ).rejects.toBeInstanceOf(IdentityError)
  })

  it('static-jwt rejects an expired token and a wrong secret', async () => {
    const expired = signHs256({sub: 'alice', exp: Math.floor(Date.now() / 1000) - 10}, SECRET)
    await expect(
      new StaticJwtIdentityProvider().resolve({argv: [], env: {ACLIF_IDENTITY_TOKEN: expired, ACLIF_IDENTITY_SECRET: SECRET}}),
    ).rejects.toThrow(/expired/)
    const token = signHs256({sub: 'alice'}, SECRET)
    await expect(
      new StaticJwtIdentityProvider().resolve({argv: [], env: {ACLIF_IDENTITY_TOKEN: token, ACLIF_IDENTITY_SECRET: 'other'}}),
    ).rejects.toThrow(/signature/)
  })

  it('static-jwt errors when a token is presented without a secret', async () => {
    const token = signHs256({sub: 'alice'}, SECRET)
    await expect(new StaticJwtIdentityProvider().resolve({argv: [], env: {ACLIF_IDENTITY_TOKEN: token}})).rejects.toThrow(
      /ACLIF_IDENTITY_SECRET/,
    )
  })

  it('verifyHs256 rejects other algorithms and missing sub is an identity error', async () => {
    const none = Buffer.from(JSON.stringify({alg: 'none'})).toString('base64url')
    const body = Buffer.from(JSON.stringify({sub: 'x'})).toString('base64url')
    expect(() => verifyHs256(`${none}.${body}.`, SECRET)).toThrow(/unsupported algorithm/)
    const noSub = signHs256({email: 'nobody@example.com'}, SECRET)
    await expect(
      new StaticJwtIdentityProvider().resolve({argv: [], env: {ACLIF_IDENTITY_TOKEN: noSub, ACLIF_IDENTITY_SECRET: SECRET}}),
    ).rejects.toThrow(/sub/)
  })

  it('createIdentityProvider knows both providers and rejects others', () => {
    expect(createIdentityProvider('anonymous').name).toBe('anonymous')
    expect(createIdentityProvider('static-jwt').name).toBe('static-jwt')
    expect(() => createIdentityProvider('okta')).toThrow(/Unknown identity provider/)
  })
})
