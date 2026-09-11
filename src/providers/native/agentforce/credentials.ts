// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {CredentialSchema} from '../../../core/provider/credential-schema.js'

/** Agentforce authentication. Field order is the order the auth flags appear in --schema. */
export const agentforceCredentials: CredentialSchema = {
  fields: {
    instanceUrl: {flag: 'my-domain-url', env: 'AGENTFORCE_MY_DOMAIN_URL', description: 'Salesforce my.salesforce.com domain URL (e.g., https://acme.my.salesforce.com)'},
    clientId: {flag: 'client-id', env: 'AGENTFORCE_CLIENT_ID', description: 'External Client App consumer key (OAuth client_id)'},
    clientSecret: {flag: 'client-secret', env: 'AGENTFORCE_CLIENT_SECRET', description: 'External Client App consumer secret', secret: true},
    defaultAgentId: {flag: 'agent-id', env: 'AGENTFORCE_AGENT_ID', description: 'Default agent ID for `sessions start` when not supplied per-call'},
  },
  paths: [
    {authType: 'client-credentials', requires: ['instanceUrl', 'clientId', 'clientSecret'], optional: ['defaultAgentId'], description: 'External Client App client credentials'},
  ],
}
