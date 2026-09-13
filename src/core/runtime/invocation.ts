// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Invocation: the explicit, per-request execution context for a ACI command.
 *
 * Every command execution — whether via the CLI binary or the embedded gateway
 * runtime — is described by an Invocation. This is the abstraction that lets
 * commands run safely in a long-lived host process without relying on
 * process-global state (env vars, stdout, exit, signal handlers).
 *
 * The CLI binary builds an Invocation from process.argv/process.env/process.stdout.
 * The gateway builds an Invocation from an HTTP request and a vault-backed
 * credential resolver. The same command class runs in both hosts, unmodified.
 */

import type {ServiceAccountCredentials} from '../contract/aci.js'
import type {Reporter} from '../output/reporter.js'
import type {ConnectionPool} from './connection-pool.js'
import type {CredentialResolver} from './credential-resolver.js'
import type {TenantCache} from '../provider/tenant.js'
import type {AliasStore} from '../alias/alias-set.js'

/**
 * Identity, audit, and request scope for a single command execution.
 */
export interface ExecutionContext {
  /** Correlation id for logs and audit events */
  requestId: string

  /** Authenticated user (when present) */
  user?: {
    id: string
    username: string
    profile?: string
  }

  /** SSO claims forwarded to providers when needed */
  sso?: {
    token?: string
    orgId?: string
    [claim: string]: unknown
  }

  /** Cooperative cancellation signal */
  abortSignal?: AbortSignal

  /** Free-form metadata included in audit events (e.g., appId, sessionId) */
  metadata?: Record<string, unknown>
}

/**
 * Hooks the runtime invokes during command execution.
 */
export interface InvocationHooks {
  /**
   * Called after argv parsing, before command execution.
   * Receives the command's metadata and the resolved input.
   * If the gate denies the operation, throw a AciRuntimeError or return
   * {allowed: false}.
   */
  capabilityGate?: (
    cmd: CapabilityGateInput,
    ctx: ExecutionContext,
  ) => Promise<GateDecision>

  /**
   * Called before each provider API call.
   * Used by rate limiters and circuit breakers.
   */
  rateLimit?: (provider: string, operation?: string) => Promise<void>
}

export interface CapabilityGateInput {
  commandId: string
  /** AciMetadata from the command class — read-only */
  aciMetadata: import('../contract/aci.js').AciMetadata
  /** Argv slice for the command (without the command id portion) */
  argv: string[]
}

export interface GateDecision {
  allowed: boolean
  /** Optional structured error to surface when denied */
  error?: import('../contract/aci.js').AciError
  /** Field paths the runtime should redact from the response */
  redactFields?: string[]
}

/**
 * The complete Invocation passed to runtime.run().
 */
export interface Invocation {
  /**
   * The argv that the CLI would receive.
   * Example: ['salesforce', 'data', 'dml', 'insert', 'Account', '--values', '{"Name":"Acme"}']
   *
   * The leading 'aclif' (if any) and the global '--json' flag are stripped/added
   * automatically by the runtime as needed.
   */
  argv: string[]

  /** Identity, audit, and request scope */
  context: ExecutionContext

  /** Typed credential lookup. Replaces process.env reads in commands. */
  credentials: CredentialResolver

  /** Connection pool. Replaces module-global LRU caches. */
  pool: ConnectionPool

  /** Output channel. Replaces this.log() → process.stdout. */
  reporter: Reporter

  /** Optional pre-execution hooks (capability gate, rate limit) */
  hooks?: InvocationHooks

  /** Host-owned tenant catalog store; the binary uses a file cache when absent. */
  tenantCache?: TenantCache

  /** Host-owned canonical alias store; the binary reads config.yaml and the starter vocabulary when absent. */
  aliasStore?: AliasStore
}
