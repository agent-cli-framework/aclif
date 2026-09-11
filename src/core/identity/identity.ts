// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Identity: who is running the command.
 *
 * Standalone, an IdentityProvider resolves it from argv and the environment
 * (anonymous by default). Embedded hosts do not use providers; they supply
 * identity on Invocation.context. See docs/EMBEDDING.md, Credentials.
 */
export interface Identity {
  id: string
  displayName?: string
  email?: string
  orgId?: string
  claims?: Record<string, unknown>
}

export interface IdentityInput {
  argv: string[]
  env: NodeJS.ProcessEnv
}

export interface IdentityProvider {
  readonly name: string
  /** Undefined means "no identity presented"; a thrown IdentityError means one was presented and rejected. */
  resolve(input: IdentityInput): Promise<Identity | undefined>
}

/** A token or credential was presented and could not be accepted. Exit code 3. */
export class IdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityError'
  }
}
