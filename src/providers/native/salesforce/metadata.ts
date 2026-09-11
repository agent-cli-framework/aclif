// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {ProviderMetadata} from '../../../core/contract/aci.js'

export const salesforceMetadata: ProviderMetadata = {
  name: 'salesforce',
  description: 'Salesforce CRM and Platform operations',
  overview: 'Salesforce CRM and Platform. Core objects: Account, Contact, Opportunity, Lead, Case. Query via SOQL, search via SOSL, mutate via DML operations.',
  querySyntax: 'SOQL: SELECT <fields> FROM <object> [WHERE <condition>] [ORDER BY <field> [ASC|DESC]] [LIMIT <n>] [OFFSET <n>]',
  providerSpecificFlags: [
    '--instance-url — Salesforce instance URL (e.g., https://myorg.my.salesforce.com)',
    '--access-token — Session/bearer token for pre-authenticated access',
    '--sf-username + --sf-password + --security-token — Username/password auth',
    '--client-id + --client-secret — OAuth2 client credentials flow',
  ],
  topics: {
    files: {
      description: 'Links to files and attachments in the Salesforce UI',
      commands: ['view-url'],
      keyFields: ['id', 'url'],
      commonPatterns: [
        'Open a file in the browser: $BIN salesforce files view-url --content-document-id 069xx --json',
      ],
    },
    data: {
      description: 'Query and manage Salesforce records',
      commands: ['query', 'aggregate', 'describe', 'dml', 'search', 'search-objects'],
      keyFields: ['Id', 'Name', 'CreatedDate', 'LastModifiedDate', 'OwnerId'],
      commonPatterns: [
        'List accounts: $BIN salesforce data query --query "SELECT Id, Name FROM Account LIMIT 10" --json',
        'Filter by field: $BIN salesforce data query --query "SELECT Id, Name, Industry FROM Account WHERE Industry = \'Technology\'" --json',
        'Aggregate: $BIN salesforce data aggregate Account --select "Industry, COUNT(Id)" --group-by Industry --json',
        'Describe object: $BIN salesforce data describe Account --json',
        'Insert record: $BIN salesforce data dml insert Account --values \'{"Name":"Test Corp"}\' --json',
        'Update record: $BIN salesforce data dml update Account --record-id 001xx --values \'{"Industry":"Finance"}\' --json',
      ],
    },
    metadata: {
      description: 'Manage custom objects, fields, and permissions',
      commands: ['field', 'object', 'permissions'],
      keyFields: ['DeveloperName', 'Label', 'Type'],
      commonPatterns: [
        'Create custom field: $BIN salesforce metadata field create Account --field-name Status__c --type Picklist --json',
        'Create custom object: $BIN salesforce metadata object create Warranty --label "Warranty" --json',
        'Grant permissions: $BIN salesforce metadata permissions grant Account --field-name Status__c --profiles "Admin" --json',
      ],
    },
    apex: {
      description: 'Execute and manage Apex code and triggers',
      commands: ['run', 'get-class', 'deploy-class', 'get-trigger', 'deploy-trigger'],
      keyFields: ['Name', 'Body', 'Status'],
      commonPatterns: [
        'Run anonymous Apex: $BIN salesforce apex run --code "System.debug(\'Hello\');" --json',
        'Get class source: $BIN salesforce apex get-class --name MyController --json',
        'Deploy trigger: $BIN salesforce apex deploy-trigger --name AccountTrigger --object Account --body "<code>" --json',
      ],
    },
    'debug-log': {
      description: 'Manage debug logging',
      commands: ['manage'],
      keyFields: ['TracedEntityId', 'DebugLevelId', 'ExpirationDate'],
      commonPatterns: [
        'Enable debug logging: $BIN salesforce debug-log manage enable --username admin@example.com --level FINE --json',
      ],
    },
  },
}
