// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {Hook} from '@oclif/core'

import {getCommandContext} from '../../core/command-context.js'
import {isPolicyExempt} from '../../core/policy/policy.js'
import {clearOperation} from '../sigint-handler.js'
import {takeCommandOutcome} from '../outcome.js'

/**
 * finally hook: one audit line per command, on success and on failure.
 *
 * oclif's postrun runs only after a successful command; finally runs
 * regardless of outcome and receives the error, so it is the only hook
 * that can promise a line for every invocation. Written to stderr; a host
 * that wants persistence reads it there.
 */
const hook: Hook<'finally'> = async function (opts) {
  clearOperation()
  if (isPolicyExempt(opts.id)) return

  const context = getCommandContext(this.config)
  const error = opts.error as (Error & {oclif?: {exit?: number}; code?: string}) | undefined
  const outcome = takeCommandOutcome()
  const exitCode = error ? (typeof error.oclif?.exit === 'number' ? error.oclif.exit : 1) : (outcome?.exitCode ?? 0)

  const line: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    user: context?.identity?.id ?? null,
    command: opts.id ?? 'unknown',
    exitCode,
  }
  if (error && error.oclif?.exit === undefined) {
    line.error = {code: error.code ?? 'COMMAND_ERROR', message: error.message}
  } else if (outcome) {
    line.error = {code: outcome.error.code, message: outcome.error.message}
  }
  process.stderr.write(`[AUDIT] ${JSON.stringify(line)}\n`)
}

export default hook
