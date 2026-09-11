// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AnonymousIdentityProvider} from './anonymous.js'
import type {IdentityProvider} from './identity.js'
import {StaticJwtIdentityProvider} from './static-jwt.js'

export {AnonymousIdentityProvider} from './anonymous.js'
export {signHs256, verifyHs256, type Claims} from './hs256.js'
export {IdentityError, type Identity, type IdentityInput, type IdentityProvider} from './identity.js'
export {
  IDENTITY_SECRET_ENV,
  IDENTITY_TOKEN_ENV,
  IDENTITY_TOKEN_FLAG,
  StaticJwtIdentityProvider,
  tokenFromArgv,
} from './static-jwt.js'

export const IDENTITY_PROVIDER_NAMES = ['anonymous', 'static-jwt'] as const
export type IdentityProviderName = (typeof IDENTITY_PROVIDER_NAMES)[number]

export function createIdentityProvider(name: string): IdentityProvider {
  switch (name) {
    case 'anonymous':
      return new AnonymousIdentityProvider()
    case 'static-jwt':
      return new StaticJwtIdentityProvider()
    default:
      throw new Error(`Unknown identity provider '${name}'. Known: ${IDENTITY_PROVIDER_NAMES.join(', ')}`)
  }
}
