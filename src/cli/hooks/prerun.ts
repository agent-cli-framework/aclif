// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {Hook} from '@oclif/core'

import {ensureCommandContext} from '../context.js'
import {ConfigError} from '../config/profiles.js'
import type {CommandContext} from '../../core/command-context.js'
import {evaluatePolicy, isPolicyExempt} from '../../core/policy/policy.js'
import type {AciMetadata} from '../../core/contract/aci.js'

/**
 * prerun hook: policy enforcement for the standalone binary.
 *
 * Applies the config file's policy section (defaults when there is no
 * file): the optional identity gate, confirmation for commands that
 * declare it or that the policy names, and the dry-run warning for
 * high blast-radius deletes. Introspection invocations never execute a
 * mutation, so confirmation does not apply to them. Embedded hosts gate
 * through Invocation.hooks.capabilityGate instead and never run this.
 */
const hook: Hook<'prerun'> = async function (opts) {
  const id = opts.Command?.id
  if (isPolicyExempt(id)) return

  let context: CommandContext
  try {
    context = await ensureCommandContext(this.config, opts.argv, (m) => this.warn(m))
  } catch (err) {
    this.error((err as Error).message, {exit: err instanceof ConfigError ? 2 : 3})
    return
  }

  const aciMetadata = (opts.Command as unknown as {aciMetadata?: AciMetadata}).aciMetadata
  const decision = evaluatePolicy({policy: context.policy, identity: context.identity, aciMetadata, argv: opts.argv ?? []})
  for (const w of decision.warnings) this.warn(w)
  if (!decision.allowed) this.error(decision.message ?? 'Denied by policy', {exit: decision.exit ?? 3})
}

export default hook
