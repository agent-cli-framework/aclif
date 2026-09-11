// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {AciError} from '../../../core/contract/aci.js'

/**
 * Google error hints. Returns undefined when no hint applies, so the
 * generic mapping in the base command is used.
 */
export function classifyGoogleError(error: unknown): AciError | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message.toLowerCase()
  const hint: AciError = {code: 'COMMAND_ERROR', message: error.message}
    if (msg.includes('403') || msg.includes('forbidden') || msg.includes('insufficient permission')) {
      hint.code = 'INSUFFICIENT_ACCESS'
      hint.syntaxGuide = 'Check OAuth scopes. For Workspace: verify Domain-Wide Delegation in Google Admin Console. For personal Gmail: re-authorize with the required scopes.'
      hint.workingExample = '$BIN google introspect --json'
    } else if (msg.includes('404') || msg.includes('not found') || msg.includes('notfound')) {
      hint.code = 'RESOURCE_NOT_FOUND'
      hint.syntaxGuide = 'Verify resource ID. Use the query command to find resources.'
    } else if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
      hint.code = 'RATE_LIMITED'
      hint.syntaxGuide = 'API quota exceeded. Retry after the indicated period.'
    } else if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid_grant')) {
      hint.code = 'AUTHENTICATION_FAILED'
      hint.syntaxGuide = 'Credentials expired or revoked. For OAuth2: re-authorize to get a new refresh token. For service accounts: check key expiry.'
      hint.workingExample = '$BIN google introspect --json'
    } else if (msg.includes('invalid_scope') || msg.includes('scope')) {
      hint.code = 'INVALID_SCOPE'
      hint.syntaxGuide = 'Required OAuth scopes not granted. Re-authorize with the correct scopes, or configure Domain-Wide Delegation.'
    } else if (msg.includes('invalid_client') || msg.includes('unauthorized_client')) {
      hint.code = 'INVALID_CLIENT'
      hint.syntaxGuide = 'OAuth2 client ID or secret is invalid. Check GW_CLIENT_ID and GW_CLIENT_SECRET.'
    }
  return hint.code === 'COMMAND_ERROR' ? undefined : hint
}
