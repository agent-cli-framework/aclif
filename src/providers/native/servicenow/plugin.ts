// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * ServiceNow provider plugin: the one file the registry imports.
 */
import {defineProvider} from '../../../core/provider/plugin.js'
import type {ProviderCommandClass} from '../../../core/provider/plugin.js'
import {createClient} from './client.js'
import {servicenowCredentials} from './credentials.js'
import {classifyServiceNowError} from './errors.js'
import {servicenowMetadata} from './metadata.js'
import {servicenowTenant} from './tenant.js'
import ServicenowDataAggregate from './commands/data/aggregate.js'
import ServicenowDataAttachmentViewUrl from './commands/data/attachment-view-url.js'
import ServicenowDataDescribe from './commands/data/describe.js'
import ServicenowDataDml from './commands/data/dml.js'
import ServicenowDataQuery from './commands/data/query.js'
import ServicenowDataSearch from './commands/data/search.js'
import ServicenowDiscover from './commands/discover.js'
import ServicenowIntrospect from './commands/introspect.js'
import ServicenowScriptRun from './commands/script/run.js'

export const servicenowPlugin = defineProvider({
  name: 'servicenow',
  displayName: 'ServiceNow',
  description: 'ServiceNow ITSM and Platform operations',
  metadata: servicenowMetadata,
  credentials: servicenowCredentials,
  createClient,
  classifyError: classifyServiceNowError,
  tenant: servicenowTenant,
  http: (client) => ({request: (r) => client.rawRequest(r.method, r.path, r.query, r.body)}),
  healthProbe: ['servicenow', 'data', 'query', '--table', 'sys_user', '--limit', '1'],
  commands: {
    'servicenow:data:aggregate': ServicenowDataAggregate,
    'servicenow:data:attachment-view-url': ServicenowDataAttachmentViewUrl,
    'servicenow:data:describe': ServicenowDataDescribe,
    'servicenow:data:dml': ServicenowDataDml,
    'servicenow:data:query': ServicenowDataQuery,
    'servicenow:data:search': ServicenowDataSearch,
    'servicenow:discover': ServicenowDiscover,
    'servicenow:introspect': ServicenowIntrospect,
    'servicenow:script:run': ServicenowScriptRun,
  } as Record<string, ProviderCommandClass>,
})
