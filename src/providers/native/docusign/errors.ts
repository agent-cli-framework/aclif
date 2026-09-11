// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {AciError} from '../../../core/contract/aci.js'

/**
 * DocuSign error hints. Returns undefined when no hint applies, so the
 * generic mapping in the base command is used.
 */
export function classifyDocuSignError(error: unknown): AciError | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message.toLowerCase()
  const hint: AciError = {code: 'COMMAND_ERROR', message: error.message}
    if (msg.includes('consent_required')) {
      hint.code = 'CONSENT_REQUIRED'
      hint.syntaxGuide =
        'The impersonated DocuSign user has not granted consent for this integration key. ' +
        'Open the consent URL from the error message once in a browser and click Accept.'
    } else if (msg.includes('(401)') || msg.includes('unauthorized') || msg.includes('invalid_grant')) {
      hint.code = 'AUTHENTICATION_FAILED'
      hint.syntaxGuide = 'Check integration key, impersonated user ID, and RSA private key. Sandbox uses account-d.docusign.com; production uses account.docusign.com.'
    } else if (msg.includes('(404)') || msg.includes('envelope_does_not_exist')) {
      hint.code = 'ENVELOPE_NOT_FOUND'
      hint.syntaxGuide = 'Verify --envelope-id is correct. Use "$BIN docusign envelopes list" to find envelope IDs.'
    } else if (msg.includes('(403)') || msg.includes('insufficient')) {
      hint.code = 'INSUFFICIENT_ACCESS'
      hint.syntaxGuide = 'Check that the impersonated user has permission to perform this operation in the DocuSign account.'
    } else if (msg.includes('(422)') || msg.includes('invalid_request')) {
      hint.code = 'INVALID_REQUEST'
      hint.syntaxGuide = 'DocuSign rejected the envelope payload. Check signer email/name and document content.'
    }
  return hint.code === 'COMMAND_ERROR' ? undefined : hint
}
