// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {GoogleBaseCommand} from '../base.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

/**
 * Introspect Google Workspace permissions for the authenticated service account.
 * Validates Domain-Wide Delegation setup by probing each API scope.
 *
 * Examples:
 *   aclif google introspect --json
 */
export default class GoogleIntrospect extends GoogleBaseCommand {
  static override description = 'Validate Google Workspace service account permissions and Domain-Wide Delegation scopes'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 4,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "Which Google API scopes the credentials can exercise",
    fields: {
      introspectedAt: {type: "string", description: "ISO timestamp"},
      serviceAccountId: {type: "string", description: "impersonated or authenticated user"},
      summary: {type: "object", description: "{totalScopes, authorized, denied}"},
      systemPermissions: {type: "object", description: "{domainWideDelegation}"},
      scopes: {type: "array", description: "array of {scope, service, authorized, error}"},
      remediation: {type: "string", description: "next step when scopes are denied, else null"},
    },
    example: {"introspectedAt": "2026-09-11T00:00:00.000Z", "serviceAccountId": "user@example.com", "summary": {"totalScopes": 4, "authorized": 3, "denied": 1}, "systemPermissions": {"domainWideDelegation": true}, "scopes": [{"scope": "https://www.googleapis.com/auth/gmail.readonly", "service": "gmail", "authorized": true, "error": null}], "remediation": null},
  }

  static override flags = {
    ...GoogleBaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return

    try {
      const conn = await this.getConnection()

      const scopeResults: Array<{
        service: string
        scope: string
        status: 'authorized' | 'denied' | 'error'
        detail?: string
      }> = []

      // Probe Gmail read access
      try {
        const gmailProxy = conn.gmail()
        const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail
        await gmail.users.getProfile({userId: 'me'})
        scopeResults.push({
          service: 'gmail',
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          status: 'authorized',
        })
      } catch (error) {
        scopeResults.push({
          service: 'gmail',
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          status: 'denied',
          detail: error instanceof Error ? error.message : String(error),
        })
      }

      // Probe Gmail send access
      try {
        const gmailProxy = conn.gmail()
        const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail
        // Listing drafts is a lightweight way to check send scope
        await gmail.users.drafts.list({userId: 'me', maxResults: 1})
        scopeResults.push({
          service: 'gmail',
          scope: 'https://www.googleapis.com/auth/gmail.send',
          status: 'authorized',
        })
      } catch (error) {
        scopeResults.push({
          service: 'gmail',
          scope: 'https://www.googleapis.com/auth/gmail.send',
          status: 'denied',
          detail: error instanceof Error ? error.message : String(error),
        })
      }

      // Probe Calendar access
      try {
        const calProxy = conn.calendar()
        const cal = await calProxy.getClient() as import('@googleapis/calendar').calendar_v3.Calendar
        await cal.calendarList.list({maxResults: 1})
        scopeResults.push({
          service: 'calendar',
          scope: 'https://www.googleapis.com/auth/calendar',
          status: 'authorized',
        })
      } catch (error) {
        scopeResults.push({
          service: 'calendar',
          scope: 'https://www.googleapis.com/auth/calendar',
          status: 'denied',
          detail: error instanceof Error ? error.message : String(error),
        })
      }

      // Probe Calendar events access
      try {
        const calProxy = conn.calendar()
        const cal = await calProxy.getClient() as import('@googleapis/calendar').calendar_v3.Calendar
        await cal.events.list({calendarId: 'primary', maxResults: 1})
        scopeResults.push({
          service: 'calendar',
          scope: 'https://www.googleapis.com/auth/calendar.events',
          status: 'authorized',
        })
      } catch (error) {
        scopeResults.push({
          service: 'calendar',
          scope: 'https://www.googleapis.com/auth/calendar.events',
          status: 'denied',
          detail: error instanceof Error ? error.message : String(error),
        })
      }

      const authorizedCount = scopeResults.filter(r => r.status === 'authorized').length
      const deniedCount = scopeResults.filter(r => r.status === 'denied').length

      // Build the normalized entities map from authorized scopes.
      // The gateway's normalizeGoogle() in provider-introspection.ts consumes
      // this shape directly — keep the structure parallel to Salesforce/ServiceNow
      // introspect output so the gateway adapter can plug it into the unified
      // ProviderPermissions schema without per-provider branching.
      const authorizedScopes = scopeResults
        .filter(r => r.status === 'authorized')
        .map(r => r.scope)
      const deniedScopes = scopeResults
        .filter(r => r.status === 'denied')
        .map(r => r.scope)
      const entities = deriveGoogleEntities(authorizedScopes)

      // Get the impersonated user from the credentials if available — this
      // matches Salesforce's serviceAccountId field semantically.
      let impersonatedUser: string | undefined
      try {
        const gmailProxy = conn.gmail()
        const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail
        const profile = await gmail.users.getProfile({userId: 'me'})
        impersonatedUser = profile.data.emailAddress || undefined
      } catch {
        // Profile fetch may fail if gmail.readonly is not authorized — that's fine,
        // the field is optional.
      }

      await this.outputResult({
        introspectedAt: new Date().toISOString(),
        serviceAccountId: impersonatedUser,
        summary: {
          totalScopes: scopeResults.length,
          authorized: authorizedCount,
          denied: deniedCount,
        },
        // Normalized fields consumed by the gateway's normalizeGoogle()
        authorizedScopes,
        deniedScopes,
        entities,
        systemPermissions: {
          domainWideDelegation: authorizedScopes.length > 0,
          impersonatedUser,
        },
        // Diagnostic detail kept for human inspection / backward compatibility
        scopes: scopeResults,
        remediation: deniedCount > 0
          ? 'Some scopes are not authorized. To fix: 1) Go to Google Admin Console → Security → API controls → Domain-wide delegation. 2) Add the service account client ID. 3) Add the denied scopes to the authorized scopes list.'
          : undefined,
      }, this.buildContext({
        returned: scopeResults.length,
        refinements: deniedCount > 0
          ? ['Configure Domain-Wide Delegation in Google Admin Console for denied scopes']
          : ['All scopes authorized — Google Workspace commands are ready to use'],
        relatedCommands: [
          '$BIN google discover --json',
          '$BIN google gmail query --query "is:unread" --limit 5 --json',
          '$BIN google calendar query --json',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}

// ── Scope → entity mapping ────────────────────────────────────────────
//
// Translates the OAuth scopes that the service account has actually been
// granted into agent-friendly entity CRUD permissions. This is the
// authoritative table — the gateway side mirrors it for the introspection
// adapter (an embedding host's normalizer, if it has one, e.g. `normalizeGoogle()` in its utils/
// provider-introspection.ts) so that any changes here should be mirrored
// there. Both sides are intentionally duplicated rather than shared via
// an import because the CLI must run standalone without any gateway code.

type Op = 'read' | 'create' | 'update' | 'delete'

interface EntityGrant {
  entity: string
  ops: Op[]
}

const SCOPE_GRANTS: Record<string, EntityGrant[]> = {
  'https://www.googleapis.com/auth/gmail.readonly': [
    {entity: 'gmail:message', ops: ['read']},
    {entity: 'gmail:thread', ops: ['read']},
    {entity: 'gmail:label', ops: ['read']},
    {entity: 'gmail:draft', ops: ['read']},
  ],
  'https://www.googleapis.com/auth/gmail.metadata': [
    {entity: 'gmail:message', ops: ['read']},
  ],
  'https://www.googleapis.com/auth/gmail.compose': [
    {entity: 'gmail:draft', ops: ['read', 'create', 'update', 'delete']},
  ],
  'https://www.googleapis.com/auth/gmail.send': [
    {entity: 'gmail:draft', ops: ['create']},
  ],
  'https://www.googleapis.com/auth/gmail.labels': [
    {entity: 'gmail:label', ops: ['read', 'create', 'update', 'delete']},
  ],
  'https://www.googleapis.com/auth/gmail.modify': [
    {entity: 'gmail:message', ops: ['read', 'update']},
    {entity: 'gmail:thread', ops: ['read']},
    {entity: 'gmail:label', ops: ['read', 'create', 'update', 'delete']},
    {entity: 'gmail:draft', ops: ['read', 'create', 'update', 'delete']},
  ],
  'https://mail.google.com/': [
    {entity: 'gmail:message', ops: ['read', 'create', 'update', 'delete']},
    {entity: 'gmail:thread', ops: ['read', 'create', 'update', 'delete']},
    {entity: 'gmail:label', ops: ['read', 'create', 'update', 'delete']},
    {entity: 'gmail:draft', ops: ['read', 'create', 'update', 'delete']},
  ],
  'https://www.googleapis.com/auth/calendar.readonly': [
    {entity: 'calendar:calendar', ops: ['read']},
    {entity: 'calendar:event', ops: ['read']},
  ],
  'https://www.googleapis.com/auth/calendar.events.readonly': [
    {entity: 'calendar:event', ops: ['read']},
  ],
  'https://www.googleapis.com/auth/calendar.events': [
    {entity: 'calendar:event', ops: ['read', 'create', 'update', 'delete']},
  ],
  'https://www.googleapis.com/auth/calendar': [
    {entity: 'calendar:calendar', ops: ['read', 'create', 'update', 'delete']},
    {entity: 'calendar:event', ops: ['read', 'create', 'update', 'delete']},
  ],
}

interface EntityPerms {
  read: boolean
  create: boolean
  update: boolean
  delete: boolean
}

/**
 * Walk the authorized OAuth scopes and OR-merge their entity grants into
 * a single map. The merge is "additive": if any scope grants `read` on
 * `gmail:message`, the result has `read=true`.
 */
function deriveGoogleEntities(authorizedScopes: string[]): Record<string, EntityPerms> {
  const result: Record<string, EntityPerms> = {}
  for (const scope of authorizedScopes) {
    const grants = SCOPE_GRANTS[scope]
    if (!grants) continue
    for (const grant of grants) {
      if (!result[grant.entity]) {
        result[grant.entity] = {read: false, create: false, update: false, delete: false}
      }
      for (const op of grant.ops) {
        result[grant.entity][op] = true
      }
    }
  }
  return result
}
