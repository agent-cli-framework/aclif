// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {Connection} from 'jsforce'

import type {TenantCatalog, TenantEntity, TenantField, TenantWalk, TenantWalkOptions} from '../../../core/provider/tenant.js'
import type {DiscoveredField} from '../../../core/contract/aci.js'
import {CORE_ENTITIES, discoverSchema, type DiscoveryResult} from './discovery.js'

export {CORE_ENTITIES}

function toField(f: DiscoveredField): TenantField {
  const out: TenantField = {name: f.name, label: f.label, type: f.type, custom: f.name.endsWith('__c')}
  const values = (f.picklistValues ?? []).filter((p) => p.active).map((p) => p.value)
  if (values.length) out.enum = values
  if (f.referenceTo?.length) out.references = f.referenceTo
  return out
}

/** Pure mapping from the describe walk to a TenantCatalog; exported for tests. */
export function catalogFromDiscovery(result: DiscoveryResult): TenantCatalog {
  const entities: TenantEntity[] = result.customObjects.map((o) => ({
    name: o.apiName,
    label: o.label,
    custom: true,
    fields: o.fields.map(toField),
    provenance: 'metadata',
  }))
  for (const [name, fields] of result.standardObjectCustomFields) {
    if (!fields.length) continue
    entities.push({name, label: name, custom: false, fields: fields.map(toField), provenance: 'metadata'})
  }
  entities.sort((a, b) => a.name.localeCompare(b.name))
  return {
    provider: 'salesforce',
    capturedAt: result.discoveredAt,
    apiVersion: result.apiVersion,
    entities,
    permissions: null,
  }
}

export const salesforceTenant: TenantWalk<Connection> = {
  coreEntities: CORE_ENTITIES,
  async buildCatalog(conn: Connection, opts?: TenantWalkOptions): Promise<TenantCatalog> {
    // describeGlobal plus describe per custom object and core standard
    // object: metadata reads only. `all` widens to every standard object.
    return catalogFromDiscovery(await discoverSchema(conn, {all: opts?.all, entities: opts?.entities}))
  },
}
