// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Standardized exit codes for aclif.
 *
 * 0 — Success
 * 1 — API / runtime error (oclif default for this.error())
 * 2 — Invalid usage / bad flags (oclif default for parse errors)
 * 3 — Authentication / credential failure
 */
export const ExitCode = {
  SUCCESS: 0,
  API_ERROR: 1,
  INVALID_USAGE: 2,
  AUTH_FAILURE: 3,
} as const

const AUTH_CODE = /AUTH|CREDENTIAL|UNAUTHORI[SZ]ED|INVALID_LOGIN|INVALID_SESSION|LOGIN_FAILED|SESSION_EXPIRED|TOKEN_EXPIRED/
const USAGE_CODE = /^(CONFIRMATION_REQUIRED|INVALID_USAGE|MISSING_(FLAG|ARGUMENT)|UNKNOWN_(FLAG|COMMAND|CANONICAL))$/

/**
 * Exit code for an error envelope the command reports and then returns
 * from: 3 when the code or message says authentication, 2 for usage
 * errors, 1 otherwise. Callers that exit explicitly keep their own code.
 */
export function exitCodeForError(error: {code: string; message?: string}, classify?: (message: string) => string): number {
  if (AUTH_CODE.test(error.code)) return ExitCode.AUTH_FAILURE
  if (USAGE_CODE.test(error.code)) return ExitCode.INVALID_USAGE
  const cls = classify?.(error.message ?? '')
  if (cls === 'auth_failed' || cls === 'auth_required') return ExitCode.AUTH_FAILURE
  return ExitCode.API_ERROR
}
