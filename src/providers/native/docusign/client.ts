// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {readFile} from 'node:fs/promises'
import jwt from 'jsonwebtoken'

import {withDnsRetry} from '../../../util/dns-retry.js'
import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'

/**
 * Payload for POST /envelopes. The caller supplies documents + recipients;
 * the client only wraps the HTTP call.
 */
export interface CreateEnvelopeRequest {
  emailSubject: string
  emailBlurb?: string
  status: 'created' | 'sent'
  documents: Array<{
    documentBase64: string
    name: string
    fileExtension: string
    documentId: string
  }>
  recipients: {
    signers: Array<{
      email: string
      name: string
      recipientId: string
      routingOrder: string
      tabs?: {
        signHereTabs?: Array<{
          anchorString: string
          anchorUnits?: string
          anchorXOffset?: string
          anchorYOffset?: string
        }>
      }
    }>
  }
}

export interface EnvelopeSummary {
  envelopeId: string
  status: string
  emailSubject?: string
  sentDateTime?: string
  completedDateTime?: string
  lastModifiedDateTime?: string
  [key: string]: unknown
}

export interface ListEnvelopesParams {
  fromDate: string
  status?: string
  count?: number
  startPosition?: number
  /**
   * Comma-separated DocuSign folder IDs to include. If unset, DocuSign
   * returns envelopes from every folder including `recyclebin`, which
   * surfaces deleted envelopes. Pass a non-recyclebin list to hide them.
   */
  folderIds?: string
}

export interface ListEnvelopesResponse {
  envelopes?: EnvelopeSummary[]
  totalSetSize?: string
  nextUri?: string
  previousUri?: string
  resultSetSize?: string
  startPosition?: string
  endPosition?: string
}

/**
 * DocuSign permission-profile setting values arrive as JSON booleans on
 * some fields and as string-encoded "true"/"false" on others (the API is
 * inconsistent by design across subsystems). Keep the shape loose here;
 * `settingFlag()` in the introspect command coerces to boolean.
 */
export type PermissionProfileSettings = Record<string, unknown>

export interface PermissionProfile {
  permissionProfileId: string
  permissionProfileName: string
  modifiedByUsername?: string
  userCount?: string | number
  settings?: PermissionProfileSettings
}

export interface ListPermissionProfilesResponse {
  permissionProfiles?: PermissionProfile[]
}

export interface DocuSignGroup {
  groupId: string
  groupName: string
  groupType?: string
  permissionProfileId?: string
  userCount?: string | number
}

export interface ListGroupsResponse {
  groups?: DocuSignGroup[]
  resultSetSize?: string
}

export interface DocuSignUser {
  userId: string
  userName?: string
  email?: string
  permissionProfileId?: string
  permissionProfileName?: string
  groupList?: DocuSignGroup[]
  [key: string]: unknown
}

/**
 * Thin REST client for the DocuSign eSignature v2.1 API.
 *
 * Auth: JWT Grant. The client mints a short-lived access token from the
 * integration key + impersonated user + RSA private key, caches it until
 * 60s before expiry, and refreshes transparently on 401.
 */
export class DocuSignClient {
  /** DocuSign API base URI, e.g. https://demo.docusign.net — discovered via /oauth/userinfo */
  baseUri: string
  /** DocuSign API account GUID — the tenant in the /accounts/{id}/... path */
  accountId: string

  private readonly integrationKey: string
  private readonly impersonatedUserId: string
  private readonly privateKey: string
  private readonly authServer: string

  private accessToken: string | null = null
  private tokenExpiresAt = 0

  constructor(args: {
    baseUri: string
    accountId: string
    integrationKey: string
    impersonatedUserId: string
    privateKey: string
    authServer: string
  }) {
    this.baseUri = args.baseUri.replace(/\/+$/, '')
    this.accountId = args.accountId
    this.integrationKey = args.integrationKey
    this.impersonatedUserId = args.impersonatedUserId
    this.privateKey = args.privateKey
    this.authServer = args.authServer
  }

  // ── Envelopes ──────────────────────────────────────────────────────

  async listEnvelopes(params: ListEnvelopesParams): Promise<ListEnvelopesResponse> {
    const qs = this.toQueryString({
      from_date: params.fromDate,
      status: params.status,
      count: params.count,
      start_position: params.startPosition,
      folder_ids: params.folderIds,
    })
    return this.request<ListEnvelopesResponse>('GET', `/envelopes${qs ? '?' + qs : ''}`)
  }

  async getEnvelope(envelopeId: string): Promise<EnvelopeSummary> {
    return this.request<EnvelopeSummary>('GET', `/envelopes/${encodeURIComponent(envelopeId)}`)
  }

  async createEnvelope(body: CreateEnvelopeRequest): Promise<{envelopeId: string; status: string; uri?: string; statusDateTime?: string}> {
    return this.request<{envelopeId: string; status: string; uri?: string; statusDateTime?: string}>(
      'POST',
      '/envelopes',
      body,
    )
  }

  /**
   * Move an envelope to a different folder — DocuSign's canonical "delete"
   * is a move to the "recyclebin" folder, which applies to any status
   * (draft, sent, delivered, completed). Completed envelopes stay completed
   * but are filed away. Drafts disappear from the Drafts view.
   */
  async moveEnvelopeToFolder(envelopeId: string, folderId: string): Promise<void> {
    await this.request<void>('PUT', `/folders/${encodeURIComponent(folderId)}`, {
      envelopeIds: [envelopeId],
    })
  }

  /**
   * Download a document from an envelope. documentId="combined" returns
   * the merged signed PDF; "certificate" returns the Certificate of
   * Completion; otherwise it's the numeric documentId from the envelope.
   * Returns the raw bytes.
   */
  async downloadDocument(envelopeId: string, documentId = 'combined'): Promise<Uint8Array> {
    await this.ensureAccessToken()
    const url = `${this.baseUri}/restapi/v2.1/accounts/${this.accountId}/envelopes/${encodeURIComponent(envelopeId)}/documents/${encodeURIComponent(documentId)}`
    const response = await withDnsRetry(() => fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/pdf',
      },
    }))
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`DocuSign GET ${url} failed (${response.status}): ${text}`)
    }
    const buf = await response.arrayBuffer()
    return new Uint8Array(buf)
  }

  /**
   * Build a deterministic apps.docusign.com web-UI URL for the envelope.
   * No DocuSign API call — the URL is just a string formatted from the
   * connection's baseUri and the envelope id. The user lands on the
   * envelope details page in their own DocuSign session (where the
   * signed PDF renders inline natively, with download buttons).
   *
   * The earlier ``createSenderView`` approach hit DocuSign's
   * ``/envelopes/{id}/views/sender`` endpoint to mint a one-time
   * embedded-session URL, but those URLs authenticate as the
   * impersonated service account — not the platform user — so DocuSign
   * bounces a logged-in user to the login page when their own session
   * doesn't match. The deterministic URL avoids that entirely; it
   * requires the user to have a DocuSign account that can access the
   * envelope, which is the supported model.
   */
  getEnvelopeAppsUrl(envelopeId: string): {url: string} {
    // baseUri uses the API hostname (e.g. demo.docusign.net or
    // na2.docusign.net). The corresponding web-UI host swaps the API
    // host for the apps host. Demo accounts use apps-d; everything else
    // resolves to production apps. We err on the side of the prod host
    // so unknown regional sandboxes still produce a usable URL.
    const apiHost = (() => {
      try {
        return new URL(this.baseUri).hostname
      } catch {
        return ''
      }
    })()
    const appsHost = /(^|\.)demo\.docusign\.net$/i.test(apiHost)
      ? 'apps-d.docusign.com'
      : 'apps.docusign.com'
    return {
      url: `https://${appsHost}/send/documents/details/${encodeURIComponent(envelopeId)}`,
    }
  }

  // ── Permission Profiles / Groups / Users ───────────────────────────

  /**
   * List all DocuSign Permission Profiles for the account. When
   * `includeSettings` is true, the client follows up with a per-profile
   * GET to populate each profile's `settings` object — DocuSign's list
   * endpoint ignores `?include=permission_profile_settings` and only
   * returns `id/name/modifiedDateTime`, so real data requires one extra
   * round-trip per profile (typically 3–6 built-in + any customs).
   */
  async listPermissionProfiles(opts: {includeSettings?: boolean} = {}): Promise<ListPermissionProfilesResponse> {
    const list = await this.request<ListPermissionProfilesResponse>('GET', '/permission_profiles')
    if (!opts.includeSettings || !list.permissionProfiles?.length) return list

    const withSettings = await Promise.all(
      list.permissionProfiles.map(async (p) => {
        try {
          const full = await this.getPermissionProfile(p.permissionProfileId)
          return {...p, settings: full.settings}
        } catch {
          return p
        }
      }),
    )
    return {permissionProfiles: withSettings}
  }

  /**
   * Fetch a single permission profile with its full `settings` object.
   */
  async getPermissionProfile(permissionProfileId: string): Promise<PermissionProfile> {
    return this.request<PermissionProfile>(
      'GET',
      `/permission_profiles/${encodeURIComponent(permissionProfileId)}?include=permission_profile_settings`,
    )
  }

  /**
   * List DocuSign Groups for the account. Each group binds users to a
   * single `permissionProfileId` — the closest native analog to a
   * Salesforce Permission Set Group.
   */
  async listGroups(): Promise<ListGroupsResponse> {
    return this.request<ListGroupsResponse>('GET', '/groups')
  }

  /**
   * Fetch a single user — used to resolve the impersonated service
   * account's effective `permissionProfileId`.
   */
  async getUser(userId: string): Promise<DocuSignUser> {
    return this.request<DocuSignUser>('GET', `/users/${encodeURIComponent(userId)}`)
  }

  /** The user GUID this client is impersonating (JWT `sub`). */
  get impersonatedUser(): string {
    return this.impersonatedUserId
  }

  // ── Internal ───────────────────────────────────────────────────────

  /**
   * Mint a JWT assertion, exchange it for an access token, and call
   * /oauth/userinfo to discover the correct base_uri and account_id for
   * this integration key + user. Overrides constructor defaults when the
   * server returns a different base_uri (standard for sandbox routing).
   */
  /** The current access token and its expiry, for the session cache; undefined before the first exchange. */
  exportSession(): {accessToken: string; expiresAt: number} | undefined {
    return this.accessToken ? {accessToken: this.accessToken, expiresAt: this.tokenExpiresAt} : undefined
  }

  /** Adopt a cached access token; ensureAccessToken re-exchanges when it is within a minute of expiry. */
  importSession(accessToken: string, expiresAt: number): void {
    this.accessToken = accessToken
    this.tokenExpiresAt = expiresAt
  }

  private async ensureAccessToken(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    if (this.accessToken && now < this.tokenExpiresAt - 60) return

    const assertion = jwt.sign(
      {
        iss: this.integrationKey,
        sub: this.impersonatedUserId,
        aud: this.authServer,
        scope: 'signature impersonation',
      },
      this.privateKey,
      {algorithm: 'RS256', expiresIn: '1h'},
    )

    const tokenUrl = `https://${this.authServer}/oauth/token`
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    })
    const response = await withDnsRetry(() => fetch(tokenUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: body.toString(),
    }))

    if (!response.ok) {
      const text = await response.text()
      if (text.includes('consent_required')) {
        throw new Error(
          `DocuSign consent_required: the impersonated user has not granted consent for this integration key. ` +
          `Open in a browser once: https://${this.authServer}/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${this.integrationKey}&redirect_uri=https://www.docusign.com`,
        )
      }
      throw new Error(`DocuSign token exchange failed (${response.status}): ${text}`)
    }

    const data = await response.json() as {access_token: string; expires_in: number; token_type: string}
    this.accessToken = data.access_token
    this.tokenExpiresAt = now + data.expires_in

    await this.discoverBaseUri()
  }

  /**
   * Resolve base_uri + account_id via /oauth/userinfo. If the configured
   * account_id matches one of the accounts returned, adopt that account's
   * base_uri (DocuSign routes tenants across regional servers). If no
   * match, keep constructor values and trust the caller.
   */
  private async discoverBaseUri(): Promise<void> {
    const url = `https://${this.authServer}/oauth/userinfo`
    const response = await withDnsRetry(() => fetch(url, {
      headers: {Authorization: `Bearer ${this.accessToken}`},
    }))
    if (!response.ok) return

    const data = await response.json() as {accounts?: Array<{account_id: string; base_uri: string; is_default?: boolean}>}
    const accounts = data.accounts || []
    const match = accounts.find((a) => a.account_id === this.accountId)
      || accounts.find((a) => a.is_default)
      || accounts[0]
    if (match) {
      this.baseUri = match.base_uri.replace(/\/+$/, '')
      if (!this.accountId) this.accountId = match.account_id
    }
  }

  /**
   * Raw request for manifest commands. A path starting with /restapi is
   * taken relative to the base URI; anything else is relative to this
   * account's envelope API root (/restapi/v2.1/accounts/{accountId}).
   */
  async rawRequest(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<unknown> {
    const qs = query ? new URLSearchParams(query).toString() : ''
    const rel = (path.startsWith('/restapi') ? path.replace(`/restapi/v2.1/accounts/${this.accountId}`, '') : path) + (qs ? `?${qs}` : '')
    if (path.startsWith('/restapi') && !path.startsWith(`/restapi/v2.1/accounts/${this.accountId}`)) {
      throw new Error('DocuSign manifest paths must be account-relative or under this account\'s /restapi/v2.1/accounts/{accountId}')
    }
    return this.request<unknown>(method, rel, body)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.ensureAccessToken()
    const url = `${this.baseUri}/restapi/v2.1/accounts/${this.accountId}${path}`
    const response = await withDnsRetry(() => fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }))

    if (response.status === 401) {
      this.accessToken = null
      this.tokenExpiresAt = 0
      await this.ensureAccessToken()
      const retry = await withDnsRetry(() => fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      }))
      if (!retry.ok) {
        const text = await retry.text()
        throw new Error(`DocuSign ${method} ${url} failed (${retry.status}): ${text}`)
      }
      return retry.status === 204 ? ({} as T) : (await retry.json() as T)
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`DocuSign ${method} ${url} failed (${response.status}): ${text}`)
    }

    return response.status === 204 ? ({} as T) : (await response.json() as T)
  }

  private toQueryString(params: Record<string, unknown>): string {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
  }
}

// ── Factory ───────────────────────────────────────────────────────────

/**
 * A private key may be inline PEM or `@/path/to/file.pem`; keys that
 * travelled through an environment variable may carry literal \n escapes.
 */
export async function resolvePrivateKey(value: string): Promise<string> {
  let pem = value
  if (pem.startsWith('@')) pem = await readFile(pem.slice(1), 'utf8')
  if (!pem.includes('\n') && pem.includes('\\n')) pem = pem.replace(/\\n/g, '\n')
  return pem
}

/** Build a client from resolved credentials. Called through the ConnectionPool; never caches itself. */
export async function createClient(creds: ServiceAccountCredentials): Promise<DocuSignClient> {
  if (!creds.integrationKey || !creds.impersonatedUserId || !creds.privateKey) {
    throw new Error('Insufficient DocuSign credentials: integration key, impersonated user ID, and RSA private key required')
  }
  if (!creds.dsAccountId) throw new Error('DocuSign credentials are missing the API account ID (dsAccountId)')
  return new DocuSignClient({
    baseUri: creds.instanceUrl || 'https://demo.docusign.net',
    accountId: creds.dsAccountId,
    integrationKey: creds.integrationKey,
    impersonatedUserId: creds.impersonatedUserId,
    privateKey: await resolvePrivateKey(creds.privateKey),
    authServer: creds.authServer || 'account-d.docusign.com',
  })
}
