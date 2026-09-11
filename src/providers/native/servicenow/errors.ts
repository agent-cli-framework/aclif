// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {AciError} from '../../../core/contract/aci.js'

/**
 * ServiceNow error hints. Returns undefined when no hint applies, so the
 * generic mapping in the base command is used.
 */
export function classifyServiceNowError(error: unknown): AciError | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message.toLowerCase()
  const hint: AciError = {code: 'COMMAND_ERROR', message: error.message}
    // The HTTP status decides first: the failing URL carries the query
    // string, so text heuristics must not run before it.
    if (msg.includes('(401)') || msg.includes('user not authenticated') || msg.includes('unauthorized')) {
      hint.code = 'AUTHENTICATION_FAILED'
      hint.syntaxGuide = 'Check credentials. Use --instance-url + --sn-username + --sn-password or --access-token.'
    } else if (msg.includes('(403)') || msg.includes('insufficient rights') || msg.includes('not authorized')) {
      hint.code = 'INSUFFICIENT_ACCESS'
      hint.syntaxGuide = 'Check ServiceNow ACLs for table/field access. Use --dry-run to preview.'
    } else if (msg.includes('(404)') || msg.includes('record not found') || msg.includes('no record found')) {
      hint.code = 'RECORD_NOT_FOUND'
      hint.syntaxGuide = 'Verify sys_id is correct. Use "$BIN servicenow data query" to find records.'
    } else if (msg.includes('invalid table') || msg.includes('could not find table') || msg.includes('no resource found')) {
      hint.code = 'INVALID_TABLE'
      hint.syntaxGuide = 'Use "$BIN servicenow discover" to list available tables'
      hint.workingExample = '$BIN servicenow discover --json'
    } else if (msg.includes('invalid query') || msg.includes('invalid encoded query') || msg.includes('syntax error')) {
      hint.code = 'INVALID_QUERY'
      hint.syntaxGuide = 'Encoded query syntax: field=value^field2!=value2. Operators: =, !=, LIKE, >, <, >=, <='
      hint.workingExample = '$BIN servicenow data query --table incident --query "active=true^priority=1" --json'
    }
  return hint.code === 'COMMAND_ERROR' ? undefined : hint
}
