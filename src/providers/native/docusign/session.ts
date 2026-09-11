// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {SessionSnapshot, SessionSupport} from '../../../core/credentials/session-cache.js'
import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'
import {createClient, type DocuSignClient} from './client.js'

/** DocuSign keeps the JWT-grant access token with its expiry; the private key is never stored. */
export const docusignSession: SessionSupport<DocuSignClient> = {
  save(client: DocuSignClient): SessionSnapshot | undefined {
    const s = client.exportSession()
    if (!s) return undefined
    return {expiresAt: new Date(s.expiresAt * 1000).toISOString(), state: {accessToken: s.accessToken, expiresAt: s.expiresAt}}
  },
  async restore(creds: ServiceAccountCredentials, snapshot: SessionSnapshot): Promise<DocuSignClient> {
    const {accessToken, expiresAt} = snapshot.state as {accessToken?: string; expiresAt?: number}
    if (!accessToken || typeof expiresAt !== 'number') throw new Error('session snapshot incomplete')
    const client = await createClient(creds)
    client.importSession(accessToken, expiresAt)
    return client
  },
}
