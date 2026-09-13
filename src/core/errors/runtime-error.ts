// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * AciRuntimeError: structured error class for embedded execution.
 *
 * Replaces direct calls to process.exit() and this.error() (which under the
 * hood calls process.exit). Throwing AciRuntimeError lets the runtime
 * translate it into a structured response envelope without killing the host
 * process.
 *
 * The CLI binary still receives the same exit codes — bin/run.js catches
 * AciRuntimeError and translates the exit code to process.exit().
 */

import type {AciError} from '../contract/aci.js'

export class AciRuntimeError extends Error {
  readonly aciError: AciError
  readonly exitCode: number

  constructor(opts: {error: AciError; exitCode?: number}) {
    super(opts.error.message)
    this.name = 'AciRuntimeError'
    this.aciError = opts.error
    this.exitCode = opts.exitCode ?? 1
  }

  /**
   * Convenience constructor for the common case of building an error from
   * a code + message.
   */
  static of(code: string, message: string, opts: Partial<AciError> & {exitCode?: number} = {}): AciRuntimeError {
    const exitCode = opts.exitCode ?? 1
    const aciError: AciError = {
      code,
      message,
      ...(opts.correctedValue !== undefined ? {correctedValue: opts.correctedValue} : {}),
      ...(opts.syntaxGuide !== undefined ? {syntaxGuide: opts.syntaxGuide} : {}),
      ...(opts.workingExample !== undefined ? {workingExample: opts.workingExample} : {}),
    }
    return new AciRuntimeError({error: aciError, exitCode})
  }
}

/**
 * Categorize an exit code into an error category for the gateway response.
 */
export function exitCodeToCategory(exitCode: number): 'invalid_usage' | 'auth_failure' | 'api_error' | undefined {
  if (exitCode === 2) return 'invalid_usage'
  if (exitCode === 3) return 'auth_failure'
  if (exitCode !== 0) return 'api_error'
  return undefined
}

/**
 * Structural check for AciRuntimeError. instanceof fails when a host
 * process holds two copies of the package (or lib/ and src/ under test),
 * and an unrecognized runtime error would be reported as a generic
 * COMMAND_ERROR with the wrong exit code.
 */
export function isAciRuntimeError(err: unknown): err is AciRuntimeError {
  if (err instanceof AciRuntimeError) return true
  const e = err as {name?: unknown; exitCode?: unknown; aciError?: unknown} | null
  return Boolean(e && typeof e === 'object' && e.name === 'AciRuntimeError' && typeof e.exitCode === 'number' && e.aciError && typeof e.aciError === 'object')
}
