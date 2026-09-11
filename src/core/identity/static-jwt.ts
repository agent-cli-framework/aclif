// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {verifyHs256} from './hs256.js'
import {IdentityError, type Identity, type IdentityInput, type IdentityProvider} from './identity.js'

export const IDENTITY_TOKEN_FLAG = '--identity-token'
export const IDENTITY_TOKEN_ENV = 'ACLIF_IDENTITY_TOKEN'
export const IDENTITY_SECRET_ENV = 'ACLIF_IDENTITY_SECRET'

/** Find `--identity-token <value>` or `--identity-token=<value>` in raw argv. */
export function tokenFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === IDENTITY_TOKEN_FLAG) return argv[i + 1]
    if (a.startsWith(`${IDENTITY_TOKEN_FLAG}=`)) return a.slice(IDENTITY_TOKEN_FLAG.length + 1)
  }
  return undefined
}

/**
 * Verifies an HS256 token presented on --identity-token or
 * ACLIF_IDENTITY_TOKEN against the secret in ACLIF_IDENTITY_SECRET and maps
 * standard claims onto Identity. The generic form of a host-minted identity
 * token; an operator who wants the gate enables it with
 * `identity.provider: static-jwt` and `policy.require_identity: true`.
 */
export class StaticJwtIdentityProvider implements IdentityProvider {
  readonly name = 'static-jwt'

  async resolve(input: IdentityInput): Promise<Identity | undefined> {
    const token = tokenFromArgv(input.argv) ?? input.env[IDENTITY_TOKEN_ENV]
    if (!token) return undefined
    const secret = input.env[IDENTITY_SECRET_ENV]
    if (!secret) throw new IdentityError(`Identity token presented but ${IDENTITY_SECRET_ENV} is not set`)
    let claims
    try {
      claims = verifyHs256(token, secret)
    } catch (err) {
      throw new IdentityError(`Identity token rejected: ${(err as Error).message}`)
    }
    const id = typeof claims.sub === 'string' ? claims.sub : undefined
    if (!id) throw new IdentityError('Identity token rejected: missing sub claim')
    const str = (k: string): string | undefined => (typeof claims[k] === 'string' ? (claims[k] as string) : undefined)
    return {
      id,
      email: str('email'),
      displayName: str('name'),
      orgId: str('org_id') ?? str('orgId') ?? str('org'),
      claims,
    }
  }
}
