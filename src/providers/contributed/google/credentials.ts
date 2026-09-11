// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {CredentialSchema} from '../../../core/provider/credential-schema.js'

/** Google Workspace authentication. Field order is the order the auth flags appear in --schema. */
export const googleCredentials: CredentialSchema = {
  fields: {
    serviceAccountKey: {flag: 'service-account-key', env: 'GW_SERVICE_ACCOUNT_KEY', description: 'Google service account JSON key content', secret: true},
    delegatedUser: {flag: 'delegated-user', env: 'GW_DELEGATED_USER', description: 'Email of user to impersonate via Domain-Wide Delegation'},
    clientId: {flag: 'gw-client-id', env: 'GW_CLIENT_ID', description: 'Google OAuth2 client ID'},
    clientSecret: {flag: 'gw-client-secret', env: 'GW_CLIENT_SECRET', description: 'Google OAuth2 client secret', secret: true},
    refreshToken: {flag: 'refresh-token', env: 'GW_REFRESH_TOKEN', description: 'Google OAuth2 refresh token', secret: true},
    accessToken: {flag: 'access-token', env: 'GW_ACCESS_TOKEN', description: 'Pre-obtained OAuth2 access token (short-lived)', secret: true},
  },
  paths: [
    {authType: 'service-account', requires: ['serviceAccountKey', 'delegatedUser'], description: 'Service account with Domain-Wide Delegation'},
    {authType: 'oauth2', requires: ['clientId', 'clientSecret', 'refreshToken'], description: 'OAuth2 refresh token'},
    {authType: 'session', requires: ['accessToken'], description: 'Pre-obtained access token'},
  ],
  constants: {instanceUrl: 'https://www.googleapis.com'},
}
