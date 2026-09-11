import {describe, expect, it} from 'vitest'

import {DEFAULT_POLICY, evaluatePolicy, isPolicyExempt, type Policy} from '../../src/core/policy/policy.js'
import type {AciMetadata} from '../../src/core/contract/aci.js'

const meta = (over: Partial<AciMetadata> = {}): AciMetadata => ({
  mutability: 'read',
  idempotent: true,
  reversible: false,
  blastRadius: 'single_record',
  apiCallsConsumed: 1,
  requiresConfirmation: false,
  prerequisites: [],
  ...over,
})
const alice = {id: 'alice'}

describe('U-POL-1 policy', () => {
  it('default policy allows a read with no identity', () => {
    expect(evaluatePolicy({policy: DEFAULT_POLICY, aciMetadata: meta(), argv: []})).toEqual({allowed: true, warnings: []})
  })

  it('require_identity denies with exit 3 when no identity, allows with one, and applies to introspection too', () => {
    const policy: Policy = {...DEFAULT_POLICY, require_identity: true}
    expect(evaluatePolicy({policy, aciMetadata: meta(), argv: []})).toMatchObject({allowed: false, exit: 3})
    expect(evaluatePolicy({policy, aciMetadata: meta(), argv: ['--schema']})).toMatchObject({allowed: false, exit: 3})
    expect(evaluatePolicy({policy, identity: alice, aciMetadata: meta(), argv: []})).toMatchObject({allowed: true})
  })

  it('a command that declares requiresConfirmation needs --confirm, except for introspection', () => {
    const m = meta({mutability: 'delete', requiresConfirmation: true})
    expect(evaluatePolicy({policy: DEFAULT_POLICY, aciMetadata: m, argv: []})).toMatchObject({allowed: false, exit: 2})
    expect(evaluatePolicy({policy: DEFAULT_POLICY, aciMetadata: m, argv: ['--confirm']})).toMatchObject({allowed: true})
    expect(evaluatePolicy({policy: DEFAULT_POLICY, aciMetadata: m, argv: ['--examples']})).toMatchObject({allowed: true})
  })

  it('require_confirm_for triggers by mutability, blast radius, and capability', () => {
    const policy: Policy = {...DEFAULT_POLICY, require_confirm_for: ['update', 'all_records', 'code_exec']}
    expect(evaluatePolicy({policy, aciMetadata: meta({mutability: 'update'}), argv: []})).toMatchObject({allowed: false, exit: 2})
    expect(evaluatePolicy({policy, aciMetadata: meta({blastRadius: 'all_records'}), argv: []})).toMatchObject({allowed: false, exit: 2})
    expect(evaluatePolicy({policy, aciMetadata: meta({capabilities: ['code_exec']}), argv: []})).toMatchObject({allowed: false, exit: 2})
    expect(evaluatePolicy({policy, aciMetadata: meta({mutability: 'create'}), argv: []})).toMatchObject({allowed: true})
    expect(evaluatePolicy({policy, aciMetadata: meta({mutability: 'update'}), argv: ['--confirm']})).toMatchObject({allowed: true})
  })

  it('warns on a high blast-radius delete without --dry-run', () => {
    const m = meta({mutability: 'delete', blastRadius: 'filtered_set'})
    expect(evaluatePolicy({policy: DEFAULT_POLICY, aciMetadata: m, argv: []}).warnings).toHaveLength(1)
    expect(evaluatePolicy({policy: DEFAULT_POLICY, aciMetadata: m, argv: ['--dry-run']}).warnings).toHaveLength(0)
    const quiet: Policy = {...DEFAULT_POLICY, dry_run_warning_for: []}
    expect(evaluatePolicy({policy: quiet, aciMetadata: m, argv: []}).warnings).toHaveLength(0)
  })

  it('commands without metadata are allowed and oclif built-ins are exempt', () => {
    expect(evaluatePolicy({policy: DEFAULT_POLICY, argv: []})).toMatchObject({allowed: true})
    for (const id of ['help', 'version', 'plugins', 'plugins:install', undefined]) expect(isPolicyExempt(id)).toBe(true)
    for (const id of ['discover', 'salesforce:data:query', 'helpers:x']) expect(isPolicyExempt(id)).toBe(false)
  })
})
