// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {Connection} from 'jsforce'

import type {SessionSnapshot, SessionSupport} from '../../../core/credentials/session-cache.js'
import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'
import {createClient} from './client.js'

/**
 * Salesforce keeps the session id and the instance URL the login returned.
 * No expiry is known up front; a 401 or INVALID_SESSION_ID invalidates it.
 */
export const salesforceSession: SessionSupport<Connection> = {
  save(conn: Connection): SessionSnapshot | undefined {
    if (!conn.accessToken || !conn.instanceUrl) return undefined
    return {state: {accessToken: conn.accessToken, instanceUrl: conn.instanceUrl}}
  },
  async restore(creds: ServiceAccountCredentials, snapshot: SessionSnapshot): Promise<Connection> {
    const {accessToken, instanceUrl} = snapshot.state as {accessToken?: string; instanceUrl?: string}
    if (!accessToken || !instanceUrl) throw new Error('session snapshot incomplete')
    return createClient({...creds, instanceUrl, accessToken, authType: 'session'})
  },
}
