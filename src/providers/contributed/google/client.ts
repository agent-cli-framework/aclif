// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {createHash} from 'node:crypto'

import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'

/**
 * Lightweight client wrapping Google Workspace API access.
 *
 * Unlike jsforce (single connection) or ServiceNow (single REST client),
 * googleapis creates per-service clients. We cache the authenticated auth
 * object (JWT or OAuth2Client) and lazily create per-service clients on demand.
 *
 * Three auth modes:
 *   1. Service Account + Domain-Wide Delegation (Workspace orgs)
 *   2. OAuth2 refresh token (personal Gmail / any Google account)
 *   3. Pre-obtained access token (short-lived, for testing)
 *
 * The actual `googleapis` imports are done lazily inside the factory methods
 * so that the module can be loaded without the dependency being present
 * (useful for type-checking and tests).
 */
export class GoogleWorkspaceClient {
  private authClient: unknown

  constructor(authClient: unknown) {
    this.authClient = authClient
  }

  /** Get an authenticated Gmail API client */
  gmail(): GoogleServiceProxy {
    return new GoogleServiceProxy(this.authClient, 'gmail', 'v1')
  }

  /** Get an authenticated Calendar API client */
  calendar(): GoogleServiceProxy {
    return new GoogleServiceProxy(this.authClient, 'calendar', 'v3')
  }

  /**
   * Stream the raw bytes of a Google Drive file.
   *
   * Two paths:
   *   - Native binary files (uploaded PDFs / DOCX / images): `?alt=media`
   *     returns the original bytes with the original Content-Type.
   *   - Google Docs / Sheets / Slides (which aren't binaries in Drive):
   *     `/export?mimeType=...` converts on the fly. The caller passes
   *     `exportMime` (e.g. `application/pdf`) when the file is a native
   *     Google doc.
   *
   * We bypass the `@googleapis/drive` SDK and call the Drive REST API
   * directly with the access token from the connection's auth client.
   * That keeps the dependency surface narrow (Drive SDK adds ~MBs) and
   * mirrors the Salesforce streamer's approach.
   *
   * Requires the auth client's OAuth scope to include
   * `https://www.googleapis.com/auth/drive.readonly` — which is added
   * to the seeded scope set as part of this rollout.
   */
  async streamFile(
    fileId: string,
    exportMime?: string,
  ): Promise<{bytes: Uint8Array; contentType: string; filename?: string}> {
    if (!fileId) throw new Error('streamFile requires a non-empty fileId')

    const accessToken = await this.accessToken()
    const path = exportMime
      ? `/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
      : `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
    const url = `https://www.googleapis.com${path}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: '*/*',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Google Drive GET ${url} failed (${response.status}): ${text}`)
    }

    const buf = await response.arrayBuffer()
    const disposition = response.headers.get('content-disposition') || ''
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
    return {
      bytes: new Uint8Array(buf),
      contentType: response.headers.get('content-type') || exportMime || 'application/octet-stream',
      filename: match ? decodeURIComponent(match[1]) : undefined,
    }
  }

  /**
   * GET a Drive v3 metadata endpoint and return the parsed JSON. Like
   * streamFile, this calls the REST API directly instead of the Drive SDK.
   * Failures throw with the HTTP status in the message so the error
   * classifier can map 401/403/404/429.
   */
  async driveGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const accessToken = await this.accessToken()
    const url = `https://www.googleapis.com/drive/v3${path}?${new URLSearchParams(params).toString()}`
    const response = await fetch(url, {
      method: 'GET',
      headers: {Authorization: `Bearer ${accessToken}`, Accept: 'application/json'},
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Google Drive GET ${path} failed (${response.status}): ${text}`)
    }
    return await response.json() as T
  }

  private async accessToken(): Promise<string> {
    const auth = this.authClient as {getAccessToken: () => Promise<{token?: string | null} | string>}
    const tokenResp = await auth.getAccessToken()
    const accessToken = typeof tokenResp === 'string' ? tokenResp : tokenResp?.token
    if (!accessToken) {
      throw new Error('Google auth client returned no access token — refresh likely failed')
    }
    return accessToken
  }

  /** Get the raw auth client for direct SDK usage */
  getAuth(): unknown {
    return this.authClient
  }
}

/**
 * Thin proxy that lazily creates a Google API service client.
 * Avoids importing the full googleapis bundle at module load time.
 */
export class GoogleServiceProxy {
  private authClient: unknown
  private serviceName: string
  private version: string
  private _client: unknown | null = null

  constructor(authClient: unknown, serviceName: string, version: string) {
    this.authClient = authClient
    this.serviceName = serviceName
    this.version = version
  }

  /** Get the underlying googleapis service client, creating it lazily */
  async getClient(): Promise<unknown> {
    if (this._client) return this._client

    // The auth client is either a JWT (service account) or OAuth2Client
    // (personal OAuth2). Both implement the same auth interface that the
    // googleapis service constructors accept. Cast to `any` because the
    // service constructors' `auth` param is typed narrowly and the union
    // doesn't satisfy the overload resolution.
    const auth = this.authClient as any

    // Dynamic import to avoid loading the full googleapis bundle at startup
    switch (this.serviceName) {
    case 'gmail': {
      const {gmail} = await import('@googleapis/gmail')
      this._client = gmail({version: this.version as 'v1', auth})
      break
    }
    case 'calendar': {
      const {calendar} = await import('@googleapis/calendar')
      this._client = calendar({version: this.version as 'v3', auth})
      break
    }
    default:
      throw new Error(`Unknown Google service: ${this.serviceName}`)
    }

    return this._client
  }
}

/** OAuth scopes requested for Gmail + Calendar + Drive read access */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  // gmail.modify covers drafts.create (`gmail draft`); gmail.send does not.
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  // Drive readonly: needed to stream private Drive files. Adding this scope
  // requires re-consent on existing refresh tokens.
  'https://www.googleapis.com/auth/drive.readonly',
]

// ── Factory ───────────────────────────────────────────────────────────

/**
 * Build a client from resolved credentials. Called through the ConnectionPool; never caches itself.
 * Three auth paths: service account with domain-wide delegation, OAuth2 refresh token, or a pre-obtained access token.
 */
export async function createClient(creds: ServiceAccountCredentials): Promise<GoogleWorkspaceClient> {
  if (creds.authType === 'service-account' && creds.serviceAccountKey) {
    const {JWT} = await import('google-auth-library')
    const keyData = JSON.parse(creds.serviceAccountKey) as {client_email: string; private_key: string}
    const authClient = new JWT({email: keyData.client_email, key: keyData.private_key, scopes: GOOGLE_SCOPES, subject: creds.delegatedUser})
    await authClient.authorize()
    return new GoogleWorkspaceClient(authClient)
  }
  if (creds.authType === 'oauth2' && creds.refreshToken && creds.clientId && creds.clientSecret) {
    const {OAuth2Client} = await import('google-auth-library')
    const authClient = new OAuth2Client({clientId: creds.clientId, clientSecret: creds.clientSecret})
    authClient.setCredentials({refresh_token: creds.refreshToken})
    await authClient.getAccessToken()
    return new GoogleWorkspaceClient(authClient)
  }
  if (creds.accessToken) {
    const {OAuth2Client} = await import('google-auth-library')
    const authClient = new OAuth2Client()
    authClient.setCredentials({access_token: creds.accessToken})
    return new GoogleWorkspaceClient(authClient)
  }
  throw new Error('Insufficient Google credentials: service account key + delegated user, OAuth2 client + refresh token, or an access token')
}

/**
 * Pool key: the identity is the service-account key or refresh token (hashed),
 * or the access token itself, plus the delegated user. The generic instance
 * key would merge distinct tokens on the shared googleapis.com host.
 */
export function cacheKey(creds: ServiceAccountCredentials): string {
  let keyIdentifier: string
  if (creds.serviceAccountKey) keyIdentifier = createHash('sha256').update(creds.serviceAccountKey).digest('hex').slice(0, 16)
  else if (creds.refreshToken) keyIdentifier = createHash('sha256').update(creds.refreshToken).digest('hex').slice(0, 16)
  else keyIdentifier = creds.accessToken || ''
  return createHash('sha256').update(`${keyIdentifier}:${creds.delegatedUser || ''}:${creds.authType}`).digest('hex')
}
