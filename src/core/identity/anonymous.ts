// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {Identity, IdentityProvider} from './identity.js'

/** The default: never resolves an identity. Audit lines record user: null. */
export class AnonymousIdentityProvider implements IdentityProvider {
  readonly name = 'anonymous'

  async resolve(): Promise<Identity | undefined> {
    return undefined
  }
}
