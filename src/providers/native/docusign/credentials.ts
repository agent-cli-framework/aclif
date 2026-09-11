// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {CredentialSchema} from '../../../core/provider/credential-schema.js'

/** DocuSign authentication. Field order is the order the auth flags appear in --schema. */
export const docusignCredentials: CredentialSchema = {
  fields: {
    integrationKey: {flag: 'integration-key', env: 'DS_INTEGRATION_KEY', description: 'DocuSign Integration Key (OAuth client_id)'},
    impersonatedUserId: {flag: 'user-id', env: 'DS_USER_ID', description: 'Impersonated DocuSign user GUID (API Username)'},
    dsAccountId: {flag: 'account-id', env: 'DS_ACCOUNT_ID', description: 'DocuSign API Account GUID'},
    privateKey: {flag: 'private-key', env: 'DS_PRIVATE_KEY', description: 'RSA private key PEM — inline value or @/path/to/key.pem', secret: true},
    instanceUrl: {flag: 'base-uri', env: 'DS_BASE_URI', description: 'DocuSign API base URI (default: https://demo.docusign.net, auto-discovered on first call)'},
    authServer: {flag: 'auth-server', env: 'DS_AUTH_SERVER', description: 'OAuth auth server host (account-d.docusign.com | account.docusign.com)', default: 'account-d.docusign.com'},
  },
  paths: [
    {authType: 'jwt-grant', requires: ['integrationKey', 'impersonatedUserId', 'dsAccountId', 'privateKey'], optional: ['instanceUrl', 'authServer'], description: 'JWT Grant with integration key + impersonated user + RSA private key'},
  ],
}
