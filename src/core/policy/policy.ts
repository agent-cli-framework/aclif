// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Execution policy for the standalone binary, read from the config file's
 * `policy` section and enforced by the prerun hook. Embedded hosts do their
 * own gating through Invocation.hooks.capabilityGate and never run this.
 * See docs/CONFIGURATION.md and docs/EMBEDDING.md, Hooks.
 */
import type {Identity} from '../identity/identity.js'
import type {AciMetadata, BlastRadius, Capability, Mutability} from '../contract/aci.js'

export type ConfirmTrigger = Mutability | BlastRadius | Capability

export interface Policy {
  /** Refuse every command that has no resolved identity. Exit 3. */
  require_identity: boolean
  /**
   * Require --confirm when a command's mutability, blast radius, or a
   * declared capability matches. A command's own requiresConfirmation flag
   * always applies in addition to this list.
   */
  require_confirm_for: ConfirmTrigger[]
  /** Warn when a delete without --dry-run targets one of these blast radii. */
  dry_run_warning_for: BlastRadius[]
}

export const MUTABILITIES: Mutability[] = ['read', 'create', 'update', 'delete']
export const BLAST_RADII: BlastRadius[] = ['single_record', 'filtered_set', 'all_records']
export const CAPABILITIES: Capability[] = ['code_exec', 'metadata_change', 'bulk']
export const CONFIRM_TRIGGERS: ConfirmTrigger[] = [...MUTABILITIES, ...BLAST_RADII, ...CAPABILITIES]

export const DEFAULT_POLICY: Policy = {
  require_identity: false,
  require_confirm_for: [],
  dry_run_warning_for: ['filtered_set', 'all_records'],
}

/** Flags that short-circuit execution in the base command; never a mutation, so confirmation is not required. */
export const INTROSPECTION_FLAGS = ['--schema', '--examples', '--shape', '--changelog', '--discover', '--flags-for', '--estimate']

export function isIntrospection(argv: string[]): boolean {
  return argv.some((a) => INTROSPECTION_FLAGS.includes(a))
}

/** Command ids the policy hooks never gate: oclif's own help, version, and plugin management. */
export function isPolicyExempt(id: string | undefined): boolean {
  if (!id) return true
  return ['help', 'version', 'plugins'].some((prefix) => id === prefix || id.startsWith(`${prefix}:`))
}

export interface PolicyDecision {
  allowed: boolean
  exit?: 2 | 3
  message?: string
  warnings: string[]
}

export function evaluatePolicy(input: {
  policy: Policy
  identity?: Identity
  aciMetadata?: AciMetadata
  argv: string[]
}): PolicyDecision {
  const {policy, identity, aciMetadata, argv} = input
  const warnings: string[] = []

  if (policy.require_identity && !identity) {
    return {
      allowed: false,
      exit: 3,
      message: 'Identity required. Provide --identity-token or set ACLIF_IDENTITY_TOKEN.',
      warnings,
    }
  }

  if (!aciMetadata || isIntrospection(argv)) return {allowed: true, warnings}

  const {mutability, blastRadius, requiresConfirmation} = aciMetadata
  const capabilities = aciMetadata.capabilities ?? []
  const triggered = policy.require_confirm_for.some(
    (t) => t === mutability || t === blastRadius || capabilities.includes(t as Capability),
  )
  if ((requiresConfirmation || triggered) && !argv.includes('--confirm')) {
    return {
      allowed: false,
      exit: 2,
      message: 'This command requires explicit confirmation. Add --confirm to proceed.',
      warnings,
    }
  }

  if (mutability === 'delete' && policy.dry_run_warning_for.includes(blastRadius) && !argv.includes('--dry-run')) {
    warnings.push(`High blast-radius ${mutability} operation on ${blastRadius}. Consider using --dry-run first.`)
  }

  return {allowed: true, warnings}
}
