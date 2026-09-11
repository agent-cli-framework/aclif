import {describe, expect, it} from 'vitest'

import {
  EventReporter,
  Runtime,
  type CredentialResolver,
  type Invocation,
  type ServiceAccountCredentials,
} from '../../src/index.js'

/**
 * K-4, local form: every symbol an embedding host imports from this package
 * still resolves from the package entry. Keep this list in step with the
 * symbols documented in docs/EMBEDDING.md.
 */
describe('K-4 gateway imports', () => {
  it('exports every runtime symbol the gateway uses', () => {
    expect(typeof Runtime).toBe('function')
    expect(typeof EventReporter).toBe('function')
  })

  it('exports every type the gateway uses', () => {
    // Type-only symbols: this compiles only if the types exist.
    const witness: [CredentialResolver, Invocation, ServiceAccountCredentials] | undefined = undefined
    expect(witness).toBeUndefined()
  })
})
