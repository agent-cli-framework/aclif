// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {ProviderMetadata} from '../../../core/contract/aci.js'

export const servicenowMetadata: ProviderMetadata = {
  name: 'servicenow',
  description: 'ServiceNow ITSM and Platform operations',
  overview: 'ServiceNow IT Service Management platform. Core tables: incident, change_request, problem, sys_user, cmdb_ci. Query via encoded query syntax.',
  querySyntax: 'Encoded queries: field=value^field2!=value2. Operators: =, !=, LIKE, IN, STARTSWITH, >, <, >=, <=. Chain: ^ (AND), ^OR. Order: ^ORDERBYfield, ^ORDERBYDESCfield.',
  providerSpecificFlags: [
    '--instance-url — ServiceNow instance URL (e.g., https://dev12345.service-now.com)',
    '--access-token — OAuth2 bearer token',
    '--sn-username + --sn-password — Basic authentication',
    '--client-id + --client-secret — OAuth2 client credentials',
    '--display-value (true|false|all) — Return display values instead of internal values',
  ],
  topics: {
    data: {
      description: 'Query and manage ServiceNow records',
      commands: ['query', 'aggregate', 'describe', 'dml', 'search', 'attachment-view-url'],
      keyFields: ['sys_id', 'number', 'short_description', 'state', 'priority', 'assigned_to'],
      commonPatterns: [
        'List open P1 incidents: $BIN servicenow data query --table incident --query "active=true^priority=1" --json',
        'Get user by username: $BIN servicenow data query --table sys_user --query "user_name=admin" --fields "user_name,email,name" --json',
        'Describe table: $BIN servicenow data describe incident --json',
        'Create incident: $BIN servicenow data dml insert --table incident --values \'{"short_description":"Test","priority":"3"}\' --json',
        'Update record: $BIN servicenow data dml update --table incident --sys-id <id> --values \'{"state":"6"}\' --json',
        'Aggregate: $BIN servicenow data aggregate --table incident --group-by priority --count --json',
      ],
    },
    script: {
      description: 'Execute ServiceNow background scripts',
      commands: ['run'],
      keyFields: [],
      commonPatterns: [
        'Run script: $BIN servicenow script run --code "gs.info(\'Hello\')" --confirm --json',
      ],
    },
  },
}
