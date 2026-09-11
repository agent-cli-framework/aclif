// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Error classification for the HealthMonitor.
 *
 * Takes a thrown error or stderr/response body and produces a structured
 * ErrorClass that distinguishes the failure mode (hibernation, auth, rate
 * limit, etc.) from a generic command error. This is what lets the UI show
 * "ServiceNow is hibernating" instead of just "command failed".
 */

export type ErrorClass =
  | 'ok'              // No error
  | 'hibernating'     // SaaS instance is hibernating (HTML wake-up page)
  | 'auth_required'   // HTML login page returned, no Bearer/cookie present
  | 'auth_failed'     // 401/403 response
  | 'rate_limited'    // 429 or provider-specific rate limit signal
  | 'service_error'   // 5xx response
  | 'parse_error'     // Couldn't parse response (malformed JSON, unexpected HTML)
  | 'network_error'   // Connection refused, DNS, timeout
  | 'unknown'         // Anything that didn't match a specific class

/**
 * Human-readable description of an ErrorClass for the UI.
 */
export const errorClassDescription: Record<ErrorClass, string> = {
  ok: 'Operating normally',
  hibernating: 'Instance is hibernating',
  auth_required: 'Authentication required',
  auth_failed: 'Authentication failed',
  rate_limited: 'Rate limit exceeded',
  service_error: 'Service error',
  parse_error: 'Unparseable response',
  network_error: 'Network error',
  unknown: 'Unknown error',
}

/**
 * Classify an error from a runtime command result.
 *
 * The classifier looks at:
 *   - Error message text (e.g. "Unexpected token '<', \"<html>...")
 *   - Embedded HTTP status codes (e.g. "(403)", "(429)")
 *   - Provider-specific error markers
 *
 * Detection is heuristic — different SaaS providers signal hibernation,
 * auth failure, and rate limits differently. The classifier maintains a
 * list of known patterns and returns 'unknown' when nothing matches.
 */
export function classifyError(input: {message?: string; stdout?: string; stderr?: string} | string | undefined): ErrorClass {
  if (!input) return 'unknown'

  const text = (typeof input === 'string'
    ? input
    : [input.message, input.stderr, input.stdout].filter(Boolean).join(' ')
  ).toLowerCase()

  if (!text.trim()) return 'unknown'

  // ── Hibernation (ServiceNow developer instances) ─────────────────
  // Detected by HTML body containing wake-up markers BEFORE generic HTML detection.
  if (
    text.includes('instance hibernating') ||
    text.includes('wait while we wake') ||
    text.includes('instance_hibernating') ||
    text.includes('hi.service-now.com')
  ) {
    return 'hibernating'
  }

  // ── Auth failures (specific HTTP codes from aclif error messages) ─
  if (
    text.includes('(401)') ||
    text.includes('(403)') ||
    text.includes('insufficient_access') ||
    text.includes('authentication_failed') ||
    text.includes('auth_failed') ||
    text.includes('unauthorized') ||
    text.includes('invalid_session') ||
    text.includes('session expired') ||
    text.includes('insufficient rights')
  ) {
    return 'auth_failed'
  }

  // ── Rate limiting ─────────────────────────────────────────────────
  if (
    text.includes('(429)') ||
    text.includes('rate limit') ||
    text.includes('rate_limited') ||
    text.includes('request_limit_exceeded') ||
    text.includes('api_currently_disabled') ||
    text.includes('too many requests')
  ) {
    return 'rate_limited'
  }

  // ── Service errors (5xx) ──────────────────────────────────────────
  if (text.match(/\((5\d\d)\)/) || text.includes('internal server error') || text.includes('service unavailable')) {
    return 'service_error'
  }

  // ── HTML response without specific marker → likely captive portal/login ─
  // This is the catch-all for "we got HTML instead of JSON" cases that
  // didn't match the more specific hibernation marker above.
  if (
    text.includes("unexpected token '<'") ||
    text.includes('unexpected token "<"') ||
    text.includes('<html') ||
    text.includes('<!doctype html')
  ) {
    if (text.includes('login') || text.includes('log in') || text.includes('sign in') || text.includes('signin')) {
      return 'auth_required'
    }
    // Could be hibernation page that didn't include the marker we checked above —
    // err on the side of "hibernating" rather than the more vague "parse_error"
    // because the user-facing remediation is the same.
    return 'hibernating'
  }

  // ── Network / connection errors ───────────────────────────────────
  if (
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('eai_again') ||
    text.includes('enotfound') ||
    text.includes('socket hang up') ||
    text.includes('network timeout') ||
    text.includes('fetch failed')
  ) {
    return 'network_error'
  }

  // ── Parse errors not caught above ─────────────────────────────────
  if (text.includes('not valid json') || text.includes('json.parse')) {
    return 'parse_error'
  }

  return 'unknown'
}
