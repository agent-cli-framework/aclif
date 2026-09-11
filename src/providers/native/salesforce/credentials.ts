// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {CredentialSchema} from '../../../core/provider/credential-schema.js'

/** Salesforce authentication. Field order is the order the auth flags appear in --schema. */
export const salesforceCredentials: CredentialSchema = {
  fields: {
    instanceUrl: {flag: 'instance-url', env: 'SF_INSTANCE_URL', description: 'Salesforce instance URL'},
    accessToken: {flag: 'access-token', env: 'SF_ACCESS_TOKEN', description: 'Salesforce access/session token', secret: true},
    username: {flag: 'sf-username', env: 'SF_USERNAME', description: 'Salesforce username'},
    password: {flag: 'sf-password', env: 'SF_PASSWORD', description: 'Salesforce password', secret: true},
    securityToken: {flag: 'security-token', env: 'SF_SECURITY_TOKEN', description: 'Salesforce security token', secret: true},
    clientId: {flag: 'client-id', env: 'SF_CLIENT_ID', description: 'OAuth2 client ID'},
    clientSecret: {flag: 'client-secret', env: 'SF_CLIENT_SECRET', description: 'OAuth2 client secret', secret: true},
    loginUrl: {flag: 'login-url', env: 'SF_LOGIN_URL', description: 'Login URL for username/password auth (default https://login.salesforce.com; use https://test.salesforce.com for sandboxes or the My Domain URL)'},
  },
  paths: [
    {authType: 'session', requires: ['instanceUrl', 'accessToken'], description: 'Session token'},
    {authType: 'credentials', requires: ['instanceUrl', 'username', 'password'], optional: ['securityToken', 'loginUrl'], description: 'Username + password (+ security token)'},
    {authType: 'oauth2', requires: ['instanceUrl', 'clientId', 'clientSecret'], description: 'OAuth2 client credentials'},
  ],
}
