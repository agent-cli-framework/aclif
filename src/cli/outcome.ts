// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {AciError} from '../core/contract/aci.js'

/**
 * The outcome of the current standalone command when it reported an error
 * envelope and returned normally, so the finally hook can audit the exit
 * code and error code that the process will exit with. Reset per command.
 */
export interface CommandOutcome {
  exitCode: number
  error: AciError
}

let current: CommandOutcome | undefined

export function setCommandOutcome(outcome: CommandOutcome): void {
  current = outcome
}

export function takeCommandOutcome(): CommandOutcome | undefined {
  const out = current
  current = undefined
  return out
}
