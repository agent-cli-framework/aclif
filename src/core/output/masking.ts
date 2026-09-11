// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Output secret masking for aclif.
 *
 * Recursively walks result data and replaces values of fields whose names
 * match sensitive patterns with "****". Keys are preserved so agents know
 * the field exists but the value is redacted.
 *
 * Use --full to bypass masking when unmasked values are needed.
 */

const SENSITIVE_PATTERNS: RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /api.?key/i,
  /private.?key/i,
  /authorization/i,
  /credential/i,
]

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(key))
}

export function maskSensitiveFields(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (typeof data !== 'object') return data

  if (Array.isArray(data)) {
    return data.map(item => maskSensitiveFields(item))
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key) && typeof value === 'string') {
      result[key] = '****'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = maskSensitiveFields(value)
    } else {
      result[key] = value
    }
  }

  return result
}
