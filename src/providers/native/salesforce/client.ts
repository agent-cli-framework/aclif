// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Connection} from 'jsforce'

import {withDnsRetry} from '../../../util/dns-retry.js'
import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'

/** Build an authenticated jsforce Connection. Called through the ConnectionPool; never caches itself. */
export async function createClient(creds: ServiceAccountCredentials): Promise<Connection> {
  const oauth2 = creds.authType === 'oauth2' && creds.clientId && creds.clientSecret
    ? {clientId: creds.clientId, clientSecret: creds.clientSecret, loginUrl: creds.loginUrl ?? creds.instanceUrl}
    : undefined
  const conn = new Connection({
    instanceUrl: creds.instanceUrl,
    ...(creds.loginUrl ? {loginUrl: creds.loginUrl} : {}),
    ...(oauth2 ? {oauth2} : {}),
    version: '59.0',
  })

  if (creds.authType === 'session' && creds.accessToken) {
    conn.accessToken = creds.accessToken
  } else if (oauth2) {
    // OAuth 2.0 client credentials flow against the My Domain token
    // endpoint (or --login-url). conn.login() would run a SOAP
    // username/password login with the client id as the username.
    await conn.authorize({grant_type: 'client_credentials'})
  } else if (creds.username && creds.password) {
    const password = creds.securityToken ? `${creds.password}${creds.securityToken}` : creds.password
    await conn.login(creds.username, password)
  } else {
    throw new Error('Insufficient credentials: provide username/password, OAuth2 client credentials, or session token')
  }

  installHtmlResponseGuard(conn)
  return conn
}

/** Log out on pool eviction; failures are ignored. */
export async function destroyClient(conn: Connection): Promise<void> {
  try {
    await conn.logout()
  } catch {
    // Ignore logout errors on cache eviction
  }
}

/**
 * Wrap conn.request so any HTML response (login page, maintenance page,
 * captive portal, etc.) is reported with a marker the HealthMonitor's error
 * classifier recognizes, rather than as whatever ad-hoc parse error jsforce
 * happens to throw. Symmetric with the boundary check in the ServiceNow
 * connection client.
 *
 * jsforce hides the underlying fetch, so we can't inspect Content-Type
 * directly. Instead we inspect the thrown error: jsforce surfaces HTML bodies
 * either as a parse error containing "<" or as a string the caller can sniff.
 */
function installHtmlResponseGuard(conn: Connection): void {
  const original = conn.request.bind(conn) as Connection['request']
  // Intentionally typed loosely — we only forward args and rethrow.
  ;(conn as unknown as {request: Connection['request']}).request = (async (...args: unknown[]) => {
    try {
      // Retry transient DNS hiccups (EAI_AGAIN/ENOTFOUND from the host
      // stub resolver) before surfacing the error. Anything non-DNS
      // short-circuits immediately and flows into the HTML/login
      // classifier below.
      const result = await withDnsRetry(() =>
        (original as (...a: unknown[]) => Promise<unknown>)(...args),
      )
      // jsforce hands back a text/html body as a string rather than
      // failing to parse it; treat it exactly like a parse failure.
      if (typeof result === 'string' && /^\s*</.test(result)) throw new Error(`Unexpected token '<': ${result.slice(0, 200)}`)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const lower = message.toLowerCase()
      const looksLikeHtml =
        lower.includes("unexpected token '<'") ||
        lower.includes('unexpected token "<"') ||
        lower.includes('<html') ||
        lower.includes('<!doctype html')
      if (looksLikeHtml) {
        if (lower.includes('login') || lower.includes('log in') || lower.includes('sign in') || lower.includes('signin')) {
          throw new Error(`Salesforce returned a login page (session likely expired): ${message}`)
        }
        // Salesforce instances don't truly hibernate the way ServiceNow dev
        // instances do, but maintenance windows and captive portals look the
        // same to the caller. The classifier already maps generic HTML →
        // hibernating, which produces the right user-facing remediation.
        throw new Error(`Salesforce returned HTML instead of JSON (instance unavailable): ${message}`)
      }
      throw err
    }
  }) as Connection['request']
}

/**
 * Stream the raw bytes of a Salesforce ContentVersion VersionData blob.
 *
 * jsforce 3.x doesn't expose an arraybuffer / responseType option on its
 * public Connection.request API, and the underlying transport always
 * tries to JSON-parse the body. We bypass jsforce here and call
 * /services/data/.../sobjects/ContentVersion/<id>/VersionData directly
 * with the connection's already-authenticated session token.
 *
 * Salesforce returns the file with the original Content-Type the uploader
 * supplied (PDF, DOCX, JPEG, etc.). No filename in the response — the
 * caller can fetch the matching ContentVersion row to pick a Title.
 */
export async function streamSalesforceContentVersion(
  conn: Connection,
  versionId: string,
  apiVersion = '60.0',
): Promise<{bytes: Uint8Array; contentType: string}> {
  if (!versionId) throw new Error('streamSalesforceContentVersion requires a non-empty versionId')
  const accessToken = conn.accessToken
  const instanceUrl = (conn.instanceUrl || '').replace(/\/+$/, '')
  if (!accessToken || !instanceUrl) {
    throw new Error('Salesforce connection has no accessToken / instanceUrl — login may have failed')
  }
  const url = `${instanceUrl}/services/data/v${apiVersion}/sobjects/ContentVersion/${encodeURIComponent(versionId)}/VersionData`
  const response = await withDnsRetry(() => fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: '*/*',
    },
  }))
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Salesforce GET ${url} failed (${response.status}): ${text}`)
  }
  const buf = await response.arrayBuffer()
  return {
    bytes: new Uint8Array(buf),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  }
}

