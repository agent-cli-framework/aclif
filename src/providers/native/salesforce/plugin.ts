// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Salesforce provider plugin: the one file the registry imports.
 */
import {defineProvider} from '../../../core/provider/plugin.js'
import type {ProviderCommandClass} from '../../../core/provider/plugin.js'
import {createClient, destroyClient} from './client.js'
import {salesforceCredentials} from './credentials.js'
import {classifySalesforceError} from './errors.js'
import {salesforceMetadata} from './metadata.js'
import {salesforceSession} from './session.js'
import {salesforceTenant} from './tenant.js'
import SalesforceApexDeployClass from './commands/apex/deploy-class.js'
import SalesforceApexDeployTrigger from './commands/apex/deploy-trigger.js'
import SalesforceApexGetClass from './commands/apex/get-class.js'
import SalesforceApexGetTrigger from './commands/apex/get-trigger.js'
import SalesforceApexRun from './commands/apex/run.js'
import SalesforceDataAggregate from './commands/data/aggregate.js'
import SalesforceDataDescribe from './commands/data/describe.js'
import SalesforceDataDml from './commands/data/dml.js'
import SalesforceDataQuery from './commands/data/query.js'
import SalesforceDataSearch from './commands/data/search.js'
import SalesforceDataSearchObjects from './commands/data/search-objects.js'
import SalesforceDebugLogManage from './commands/debug-log/manage.js'
import SalesforceDiscover from './commands/discover.js'
import SalesforceFilesViewUrl from './commands/files/view-url.js'
import SalesforceIntrospect from './commands/introspect.js'
import SalesforceMetadataField from './commands/metadata/field.js'
import SalesforceMetadataObject from './commands/metadata/object.js'
import SalesforceMetadataPermissions from './commands/metadata/permissions.js'

export const salesforcePlugin = defineProvider({
  name: 'salesforce',
  displayName: 'Salesforce',
  description: 'Salesforce CRM and Platform operations',
  metadata: salesforceMetadata,
  credentials: salesforceCredentials,
  createClient,
  classifyError: classifySalesforceError,
  destroyClient,
  tenant: salesforceTenant,
  session: salesforceSession,
  http: (conn) => ({
    request: (r) => {
      const qs = r.query ? `?${new URLSearchParams(r.query).toString()}` : ''
      return conn.request({
        method: r.method,
        url: `${r.path}${qs}`,
        ...(r.body !== undefined ? {body: JSON.stringify(r.body), headers: {'Content-Type': 'application/json'}} : {}),
      }) as Promise<unknown>
    },
  }),
  healthProbe: ['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Organization LIMIT 1'],
  commands: {
    'salesforce:apex:deploy-class': SalesforceApexDeployClass,
    'salesforce:apex:deploy-trigger': SalesforceApexDeployTrigger,
    'salesforce:apex:get-class': SalesforceApexGetClass,
    'salesforce:apex:get-trigger': SalesforceApexGetTrigger,
    'salesforce:apex:run': SalesforceApexRun,
    'salesforce:data:aggregate': SalesforceDataAggregate,
    'salesforce:data:describe': SalesforceDataDescribe,
    'salesforce:data:dml': SalesforceDataDml,
    'salesforce:data:query': SalesforceDataQuery,
    'salesforce:data:search': SalesforceDataSearch,
    'salesforce:data:search-objects': SalesforceDataSearchObjects,
    'salesforce:debug-log:manage': SalesforceDebugLogManage,
    'salesforce:discover': SalesforceDiscover,
    'salesforce:files:view-url': SalesforceFilesViewUrl,
    'salesforce:introspect': SalesforceIntrospect,
    'salesforce:metadata:field': SalesforceMetadataField,
    'salesforce:metadata:object': SalesforceMetadataObject,
    'salesforce:metadata:permissions': SalesforceMetadataPermissions,
  } as Record<string, ProviderCommandClass>,
})
