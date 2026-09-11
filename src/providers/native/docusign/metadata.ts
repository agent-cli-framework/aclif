// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {ProviderMetadata} from '../../../core/contract/aci.js'

export const docusignMetadata: ProviderMetadata = {
  name: 'docusign',
  description: 'DocuSign eSignature operations',
  overview: 'DocuSign electronic signature platform. Core resource: envelopes (containers for one or more documents + recipients). Auth: JWT Grant — requires integration key, impersonated user ID, and RSA private key.',
  querySyntax: 'REST query parameters. List endpoints accept from_date (required, ISO-8601), status (draft|sent|delivered|completed|declined|voided), count, start_position. No generic query language — filter on returned envelope fields.',
  providerSpecificFlags: [
    '--integration-key — DocuSign Integration Key (OAuth client_id)',
    '--user-id — Impersonated user GUID (API Username)',
    '--account-id — DocuSign API Account GUID (tenant in URL path)',
    '--private-key — RSA private key PEM (path or inline)',
    '--base-uri — API base URI (e.g., https://demo.docusign.net, discovered via /oauth/userinfo on first call)',
    '--auth-server — OAuth host (account-d.docusign.com for sandbox, account.docusign.com for prod)',
  ],
  topics: {
    envelopes: {
      description: 'Create, list, inspect, and download signature envelopes',
      commands: ['list', 'get', 'create', 'download', 'delete', 'view-url'],
      keyFields: ['envelopeId', 'status', 'emailSubject', 'sentDateTime', 'completedDateTime', 'lastModifiedDateTime'],
      commonPatterns: [
        'List envelopes from the last 30 days: $BIN docusign envelopes list --limit 50 --json',
        'Get envelope status: $BIN docusign envelopes get --envelope-id <id> --json',
        'Create draft envelope from a markdown file: $BIN docusign envelopes create --file ./nda.md --subject "Please sign NDA" --signer-email alice@example.com --signer-name "Alice" --status created --json',
        'Send envelope now (emails the signer): $BIN docusign envelopes create --file ./msa.md --subject "MSA" --signer-email signer@example.com --signer-name "Signer Example" --status sent --confirm --json',
        'Download signed PDF: $BIN docusign envelopes download --envelope-id <id> --output ./signed.pdf',
      ],
    },
  },
}
