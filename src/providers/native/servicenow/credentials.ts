// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {CredentialSchema} from '../../../core/provider/credential-schema.js'

/** ServiceNow authentication. Field order is the order the auth flags appear in --schema. */
export const servicenowCredentials: CredentialSchema = {
  fields: {
    instanceUrl: {flag: 'instance-url', env: 'SN_INSTANCE_URL', description: 'ServiceNow instance URL (e.g., https://dev12345.service-now.com)'},
    accessToken: {flag: 'access-token', env: 'SN_ACCESS_TOKEN', description: 'ServiceNow OAuth2 access token', secret: true},
    username: {flag: 'sn-username', env: 'SN_USERNAME', description: 'ServiceNow username'},
    password: {flag: 'sn-password', env: 'SN_PASSWORD', description: 'ServiceNow password', secret: true},
    clientId: {flag: 'client-id', env: 'SN_CLIENT_ID', description: 'OAuth2 client ID'},
    clientSecret: {flag: 'client-secret', env: 'SN_CLIENT_SECRET', description: 'OAuth2 client secret', secret: true},
  },
  paths: [
    {authType: 'session', requires: ['instanceUrl', 'accessToken'], description: 'OAuth2 bearer token'},
    {authType: 'credentials', requires: ['instanceUrl', 'username', 'password'], description: 'HTTP Basic with username + password'},
  ],
}
