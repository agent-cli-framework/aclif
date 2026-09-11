// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {randomUUID} from 'node:crypto'

import {withDnsRetry} from '../../../util/dns-retry.js'
import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'

/**
 * Salesforce Agentforce **Agent API** base host.
 *
 * Fixed regardless of the org's my.salesforce.com — Agent API is served
 * from a multi-tenant public endpoint; the access token alone
 * authenticates the caller and identifies the org. The Data API
 * (`/services/data/...`) and OAuth token endpoint remain org-scoped.
 */
const AGENT_API_HOST = 'https://api.salesforce.com'

export interface StartSessionRequest {
  externalSessionKey?: string
  instanceConfig?: {
    endpoint: string
  }
  tz?: string
  variables?: Array<{name: string; type: string; value: string}>
  featureSupport?: 'Streaming' | 'NoneSpecified'
  streamingCapabilities?: {chunkTypes?: string[]}
  bypassUser?: boolean
}

export interface StartSessionResponse {
  sessionId: string
  _links?: Record<string, unknown>
  messages?: AgentMessage[]
  [key: string]: unknown
}

export interface SendMessageRequest {
  message: {
    sequenceId: number
    type: 'Text' | 'Reply' | 'TransferSucceeded' | 'TransferFailed'
    text: string
  }
  variables?: Array<{name: string; type: string; value: string}>
}

export interface AgentMessage {
  type: string
  id?: string
  feedbackId?: string
  planId?: string
  isContentSafe?: boolean
  message?: string
  result?: unknown
  citedReferences?: unknown
  [key: string]: unknown
}

export interface SendMessageResponse {
  messages?: AgentMessage[]
  _links?: Record<string, unknown>
  [key: string]: unknown
}

export interface AgentDescriptor {
  id: string
  developerName: string
  label: string
  description?: string
  type?: string
  /**
   * Whether this agent can be invoked via the Agent API
   * (`POST /einstein/ai-agent/v1/agents/{id}/sessions`).
   *
   * False for `InternalCopilot` (Salesforce's "Agentforce (Default)" type —
   * the renamed Einstein Copilot). That type is UI-only; the Agent API
   * returns an empty 404 if you try. All other types are API-callable
   * unless Salesforce documents otherwise.
   */
  supportedByAgentApi: boolean
}

/**
 * Thin REST client for the Salesforce Agentforce **Agent API**
 * (`/einstein/ai-agent/v1`).
 *
 * Auth: OAuth 2.0 **client credentials** against the org's
 * `${myDomainUrl}/services/oauth2/token`. The token typically lives
 * 30–120 min (depends on the ECA's session policy). We cache it until
 * 60s before expiry and re-mint transparently — including on a 401
 * round-trip in case the ECA policy rotated mid-session.
 *
 * This client deliberately does NOT manage agent sessions across calls
 * (no internal session pool, no auto-end). Each leaf command makes one
 * HTTP call. Multi-turn lifecycle lives in the caller — snippets today,
 * the Layer-2 `delegate_to_agentforce` sandbox helper later.
 */
export class AgentForceClient {
  /** my.salesforce.com domain URL, e.g. https://acme.my.salesforce.com */
  readonly myDomainUrl: string
  /** Default agent ID, used by `sessions start` when the caller omits one */
  readonly defaultAgentId: string | undefined

  private readonly clientId: string
  private readonly clientSecret: string

  private accessToken: string | null = null
  private tokenExpiresAt = 0
  /**
   * Org-specific host returned by the OAuth token response's `instance_url`.
   * Used for the Salesforce **Data API** (`/services/data/...`) — e.g. the
   * BotDefinition SOQL in `listAgents`. Distinct from the Agent API host,
   * which is fixed regardless of org (see AGENT_API_HOST below).
   */
  private orgApiHost: string | null = null

  constructor(args: {
    myDomainUrl: string
    clientId: string
    clientSecret: string
    defaultAgentId?: string
  }) {
    this.myDomainUrl = args.myDomainUrl.replace(/\/+$/, '')
    this.clientId = args.clientId
    this.clientSecret = args.clientSecret
    this.defaultAgentId = args.defaultAgentId
  }

  // ── Sessions ───────────────────────────────────────────────────────

  async startSession(agentId: string, body?: StartSessionRequest): Promise<StartSessionResponse> {
    // Match the canonical body documented in the Agent API examples —
    // four fields, no extras. Earlier drafts defaulted `featureSupport`
    // to "Streaming" and a `tz`, neither of which appear in the docs; the
    // server returned 400. Optional fields are only sent when the caller
    // explicitly supplies them via `body`.
    //
    // `bypassUser` default is **false** so the session runs as the
    // External Client App's "Run As" user — which the platform admin
    // can configure once and which already holds all the Einstein PSLs
    // in most dev/admin orgs. `bypassUser: true` would force the
    // session through the agent's auto-created user (requires an
    // available Einstein Prompt Templates PSL per agent — easy to
    // exhaust in dev orgs). Callers can override via body.bypassUser.
    const payload: Record<string, unknown> = {
      externalSessionKey: body?.externalSessionKey ?? randomUUID(),
      instanceConfig: body?.instanceConfig ?? {endpoint: this.myDomainUrl},
      streamingCapabilities: body?.streamingCapabilities ?? {chunkTypes: ['Text']},
      bypassUser: body?.bypassUser ?? false,
    }
    if (body?.featureSupport !== undefined) payload.featureSupport = body.featureSupport
    if (body?.tz !== undefined) payload.tz = body.tz
    if (body?.variables !== undefined) payload.variables = body.variables
    return this.request<StartSessionResponse>(
      'POST',
      `/einstein/ai-agent/v1/agents/${encodeURIComponent(agentId)}/sessions`,
      payload,
    )
  }

  async sendMessage(sessionId: string, body: SendMessageRequest): Promise<SendMessageResponse> {
    // `variables` is required in the documented body shape, even when
    // empty. Auto-inject so callers don't have to remember.
    const payload = {
      ...body,
      variables: body.variables ?? [],
    }
    return this.request<SendMessageResponse>(
      'POST',
      `/einstein/ai-agent/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      payload,
    )
  }

  async endSession(sessionId: string): Promise<void> {
    // `X-Session-End-Reason` is required; allowed values: UserRequest,
    // Transfer, Expiration, Error, Other. Use the canonical header case
    // (HTTP headers are case-insensitive per RFC but some proxies care).
    await this.request<void>(
      'DELETE',
      `/einstein/ai-agent/v1/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      {'X-Session-End-Reason': 'UserRequest'},
    )
  }

  // ── Discovery ──────────────────────────────────────────────────────

  /**
   * Lightweight reachability probe — mints a token but issues no
   * other API call. Returns both hosts so `discover` commands can
   * surface where each API surface lives: the Agent API is a fixed
   * multi-tenant endpoint; the Data API is the org's my-domain (or
   * the regional pod the OAuth `instance_url` points to).
   */
  async ping(): Promise<{orgApiHost: string; agentApiHost: string; tokenExpiresAt: number}> {
    await this.ensureAccessToken()
    return {
      orgApiHost: this.orgApiHost!,
      agentApiHost: AGENT_API_HOST,
      tokenExpiresAt: this.tokenExpiresAt,
    }
  }

  /**
   * List agents available to the connected org by querying the
   * BotDefinition object via the standard Data API. Agentforce
   * agents are stored as BotDefinition records under the hood, so
   * the same client-credentials token works against `/services/data`.
   *
   * BotDefinition deliberately does NOT carry a `Description` field —
   * the human description on an Agentforce agent lives on the related
   * `Bot` / `BotVersion` records, not the top-level definition. We
   * leave `description` undefined in the descriptor to keep this
   * single-round-trip; callers that need rich text can follow up with
   * a per-agent fetch.
   */
  async listAgents(opts: {limit?: number; apiVersion?: string} = {}): Promise<AgentDescriptor[]> {
    const apiVersion = opts.apiVersion ?? 'v60.0'
    const limit = opts.limit ?? 50
    const soql =
      'SELECT Id, DeveloperName, MasterLabel, Type ' +
      'FROM BotDefinition ' +
      `WHERE IsDeleted = false ORDER BY MasterLabel LIMIT ${limit}`
    const path = `/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`
    type Row = {Id: string; DeveloperName: string; MasterLabel: string; Type: string | null}
    const resp = await this.request<{records?: Row[]; totalSize?: number}>('GET', path)
    return (resp.records ?? []).map((r) => ({
      id: r.Id,
      developerName: r.DeveloperName,
      label: r.MasterLabel,
      type: r.Type ?? undefined,
      // InternalCopilot = the renamed Einstein Copilot, aka "Agentforce
      // (Default)" — explicitly unsupported by Agent API per Salesforce
      // docs. Default-true keeps newly-introduced agent types optimistic
      // (caller will hit a clearer error if Salesforce expands the
      // exclusion list).
      supportedByAgentApi: r.Type !== 'InternalCopilot',
    }))
  }

  // ── Internal ───────────────────────────────────────────────────────

  /**
   * Mint a client-credentials access token. The token response carries
   * an `instance_url` that names the regional API pod — we use that as
   * the host for subsequent Agent API calls (NOT `myDomainUrl`, which
   * Salesforce uses as the auth/identity boundary but not necessarily
   * the API edge).
   */
  private async ensureAccessToken(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    if (this.accessToken && now < this.tokenExpiresAt - 60) return

    const tokenUrl = `${this.myDomainUrl}/services/oauth2/token`
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    })

    const response = await withDnsRetry(() => fetch(tokenUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: body.toString(),
    }))

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Agentforce token exchange failed (${response.status}): ${text}`)
    }

    // Client-credentials tokens don't return `expires_in` consistently;
    // Salesforce's session-timeout policy gates them on the server side.
    // Cap our cache at 25 minutes — short enough that we re-mint well
    // before any sensible policy expires, long enough that we're not
    // hitting the token endpoint on every call.
    const data = await response.json() as {access_token: string; instance_url?: string; expires_in?: number}
    this.accessToken = data.access_token
    this.tokenExpiresAt = now + (data.expires_in ?? 25 * 60)
    this.orgApiHost = (data.instance_url || this.myDomainUrl).replace(/\/+$/, '')
  }

  /** Raw request for manifest commands; routes Agent API paths to the public host and everything else to the org. */
  async rawRequest(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<unknown> {
    const qs = query ? new URLSearchParams(query).toString() : ''
    return this.request<unknown>(method, `${path}${qs ? `?${qs}` : ''}`, body)
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    await this.ensureAccessToken()
    // Route by path: Agent API calls go to the multi-tenant public host;
    // anything else (Data API: `/services/data/...`) goes to the org's
    // own host returned in the OAuth `instance_url`. Without this split,
    // session-start calls 404 against the my-domain (which serves the
    // Lightning Experience web app, not the Agent API).
    const host = path.startsWith('/einstein/ai-agent/')
      ? AGENT_API_HOST
      : this.orgApiHost
    const url = `${host}${path}`

    const doFetch = () => withDnsRetry(() => fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(extraHeaders ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))

    let response = await doFetch()

    // Force a re-mint on 401 — covers the case where the org's session
    // policy expired mid-cache. The DocuSign client uses the same trick.
    if (response.status === 401) {
      this.accessToken = null
      this.tokenExpiresAt = 0
      await this.ensureAccessToken()
      response = await doFetch()
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Agentforce ${method} ${path} failed (${response.status}): ${text}`)
    }

    if (response.status === 204) return {} as T
    const ct = response.headers.get('content-type') || ''
    if (!ct.includes('application/json')) {
      // A login or maintenance page arrives as HTML with a 200; it is
      // never an empty result.
      const text = await response.text()
      if (/^\s*</.test(text)) throw new Error(`Agentforce ${method} ${path} returned HTML instead of JSON: ${text.slice(0, 200)}`)
      return {} as T
    }
    return await response.json() as T
  }
}

// ── Factory ───────────────────────────────────────────────────────────

/** Build a client from resolved credentials. Called through the ConnectionPool; never caches itself. */
export async function createClient(creds: ServiceAccountCredentials): Promise<AgentForceClient> {
  if (!creds.instanceUrl || !creds.clientId || !creds.clientSecret) {
    throw new Error('Insufficient Agentforce credentials: my-domain URL, client ID, and client secret required')
  }
  return new AgentForceClient({
    myDomainUrl: creds.instanceUrl,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    defaultAgentId: creds.defaultAgentId,
  })
}
