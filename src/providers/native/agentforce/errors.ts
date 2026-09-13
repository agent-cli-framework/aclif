// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {AciError} from '../../../core/contract/aci.js'

/**
 * Agentforce error hints. Covers the common External Client App gotchas
 * so an agent can react without operator escalation. Returns undefined
 * when no hint applies, so the generic mapping is used.
 */
export function classifyAgentforceError(error: unknown): AciError | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message.toLowerCase()
  const hint = (code: string, syntaxGuide: string): AciError => ({code, message: error.message, syntaxGuide})

  if (msg.includes('invalid_client_id') || msg.includes('invalid_client')) {
    return hint(
      'INVALID_CLIENT',
      'The External Client App credentials are not recognized. ' +
        'A freshly-created ECA needs ~10 minutes to propagate before its consumer key is usable. ' +
        'See docs/providers/native/agentforce/SETUP.md.',
    )
  }
  if (msg.includes('unsupported_grant_type')) {
    return hint(
      'CLIENT_CREDENTIALS_DISABLED',
      'The ECA does not have the Client Credentials Flow enabled. ' +
        'Setup → External Client App Manager → <app> → Settings → OAuth Settings → Enable Client Credentials Flow.',
    )
  }
  if (msg.includes('invalid_grant')) {
    return hint(
      'INVALID_GRANT',
      'Token exchange rejected. Verify the ECA Run-As user is active and has the required scopes (api, chatbot_api, sfap_api).',
    )
  }
  if (msg.includes('not found') && msg.includes('agents')) {
    return hint(
      'AGENT_NOT_FOUND',
      'The supplied agent ID is not visible to the connected org. Check Setup → Agents for the canonical 18-character ID.',
    )
  }
  if (/failed \(404\):\s*$/.test(error.message) && msg.includes('/einstein/ai-agent/')) {
    // Empty-body 404 from the Agent API: the agent exists but is of a type
    // the API does not support, most commonly InternalCopilot.
    return hint(
      'AGENT_TYPE_UNSUPPORTED',
      'Empty 404 from the Agent API typically means the agent exists but is of a type the API does not support, most commonly `InternalCopilot` ("Agentforce (Default)"). ' +
        'Run `agentforce agents list` and confirm the target row has `supportedByAgentApi: true`. ' +
        'If not, create a new agent in Setup → Agentforce Studio of type "Agentforce Service Agent" (or any custom non-InternalCopilot type).',
    )
  }
  if (msg.includes('403')) {
    return hint(
      'INSUFFICIENT_SCOPE',
      'The access token lacks the required scope. Add `chatbot_api` and `sfap_api` to the ECA, wait 10 minutes, retry.',
    )
  }
  return undefined
}
