// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {TenantCatalog, TenantEntity, TenantField, TenantWalk, TenantWalkOptions} from '../../../core/provider/tenant.js'
import type {DiscoveredField, DiscoveredObject} from '../../../core/contract/aci.js'
import type {ServiceNowClient} from './client.js'
import {discoverServiceNowSchema, type ServiceNowDiscoveryResult} from './discovery.js'

export const CORE_ENTITIES = [
  'incident', 'problem', 'change_request', 'change_task',
  'sys_user', 'sys_user_group', 'cmdb_ci', 'cmdb_ci_server',
  'sc_req_item', 'sc_request', 'sc_task',
  'kb_knowledge', 'kb_category', 'task',
]

const isCustom = (name: string): boolean => name.startsWith('u_') || name.startsWith('x_')

function toField(f: DiscoveredField): TenantField {
  const out: TenantField = {name: f.name, label: f.label, type: f.type, custom: isCustom(f.name)}
  const values = (f.picklistValues ?? []).filter((p) => p.active).map((p) => p.value)
  if (values.length) out.enum = values
  if (f.referenceTo?.length) out.references = f.referenceTo
  return out
}

function toEntity(t: DiscoveredObject): TenantEntity {
  return {name: t.apiName, label: t.label, custom: t.custom || isCustom(t.apiName), fields: t.fields.map(toField), provenance: 'metadata'}
}

/** Pure mapping from the sys_dictionary walk to a TenantCatalog; exported for tests. */
export function catalogFromDiscovery(result: ServiceNowDiscoveryResult): TenantCatalog {
  return {
    provider: 'servicenow',
    capturedAt: result.discoveredAt,
    entities: result.tables.map(toEntity).sort((a, b) => a.name.localeCompare(b.name)),
    permissions: null,
  }
}

export const servicenowTenant: TenantWalk<ServiceNowClient> = {
  coreEntities: CORE_ENTITIES,
  async buildCatalog(client: ServiceNowClient, opts?: TenantWalkOptions): Promise<TenantCatalog> {
    // sys_db_object and sys_dictionary reads only. The permission probe in
    // `servicenow introspect` writes a sentinel record and stays there.
    return catalogFromDiscovery(await discoverServiceNowSchema(client, {tables: opts?.entities, includeCustom: opts?.all, withCustomTables: true}))
  },
}
