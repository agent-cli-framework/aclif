// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Transient-DNS retry helper.
 *
 * The embedded gateway runs on host networking, so it inherits the host's
 * stub resolver (systemd-resolved on 127.0.0.53). The stub occasionally
 * returns EAI_AGAIN / ENOTFOUND for names that otherwise resolve fine —
 * transient upstream hiccups that disappear on retry. Surfacing those to
 * the user as a "failed to resolve host" error is jarring, especially for
 * a single-click form submit.
 *
 * ``withDnsRetry`` runs an async operation and retries transient DNS
 * failures up to ``DNS_RETRY_MAX_ATTEMPTS`` times with a short exponential
 * backoff. Non-DNS errors short-circuit on the first attempt so real
 * failures (auth, 4xx, validation) are not retried.
 */

const DNS_RETRY_MAX_ATTEMPTS = 3
const DNS_RETRY_BASE_DELAY_MS = 150

/**
 * Recognize transient DNS errors. Node sets ``err.code`` on getaddrinfo
 * failures; jsforce and fetch also include the code in the error message,
 * so we check both.
 */
export function isTransientDnsError(err: unknown): boolean {
  const code = (err as {code?: string})?.code
  if (code === 'EAI_AGAIN' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return true
  }
  const cause = (err as {cause?: unknown})?.cause
  if (cause && cause !== err) {
    if (isTransientDnsError(cause)) return true
  }
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  return (
    lower.includes('eai_again') ||
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('etimedout')
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run ``op`` and retry transient DNS failures with backoff. Any other
 * error propagates on the first attempt.
 */
export async function withDnsRetry<T>(op: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= DNS_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await op()
    } catch (err) {
      lastErr = err
      if (isTransientDnsError(err) && attempt < DNS_RETRY_MAX_ATTEMPTS) {
        // Exponential backoff: 150ms, 300ms. Total added latency under
        // ~500ms worst case, which is imperceptible to a user but enough
        // to let the stub resolver warm its cache.
        await sleep(DNS_RETRY_BASE_DELAY_MS * attempt)
        continue
      }
      throw err
    }
  }
  // Unreachable — the loop either returns or throws — but TS needs it.
  throw lastErr
}
