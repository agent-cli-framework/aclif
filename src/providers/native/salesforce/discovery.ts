// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {Connection, DescribeSObjectResult} from 'jsforce'

import type {DiscoveredField, DiscoveredObject, PicklistValue} from '../../../core/contract/aci.js'

/**
 * Deploy-time schema discovery for Salesforce custom objects.
 * Discovers org-specific custom objects, custom fields on standard objects,
 * and managed package objects to enable dynamic command generation.
 */

export interface DiscoveryResult {
  customObjects: DiscoveredObject[]
  standardObjectCustomFields: Map<string, DiscoveredField[]>
  discoveredAt: string
  orgId: string
  apiVersion: string
}

/**
 * Discover all custom objects and custom fields in a Salesforce org.
 */
/** Standard objects the default tenant walk describes for custom fields. */
export const CORE_ENTITIES = ['Account', 'Contact', 'Opportunity', 'Lead', 'Case']

/** The wider standard set `salesforce discover` reports on. */
export const COMMON_STANDARD_OBJECTS = [
  ...CORE_ENTITIES, 'Task', 'Event',
  'Campaign', 'Contract', 'Order', 'Product2', 'Pricebook2', 'Asset',
]

export interface DiscoverSchemaOptions {
  /** Describe every queryable standard object, not only the core set. */
  all?: boolean
  /** Describe exactly these objects (custom or standard) and nothing else. */
  entities?: string[]
  /** Standard objects to describe for custom fields when neither `all` nor `entities` is set. */
  standardObjects?: string[]
}

export async function discoverSchema(conn: Connection, opts: DiscoverSchemaOptions = {}): Promise<DiscoveryResult> {
  const globalDescribe = await conn.describeGlobal()

  const customObjects: DiscoveredObject[] = []
  const standardObjectCustomFields = new Map<string, DiscoveredField[]>()

  // Separate custom and standard objects. The default walk describes every
  // custom object plus the core standard objects (C-TEN-3); `all` widens to
  // every queryable standard object; `entities` restricts to a list.
  const queryable = new Map(globalDescribe.sobjects.filter((o) => o.queryable).map((o) => [o.name, o]))
  const wanted = opts.entities ? opts.entities.filter((n) => queryable.has(n)) : [...queryable.keys()]
  const customObjectNames = wanted.filter((n) => queryable.get(n)!.custom)
  const standardObjectNames = opts.entities || opts.all
    ? wanted.filter((n) => !queryable.get(n)!.custom)
    : (opts.standardObjects ?? CORE_ENTITIES).filter((n) => queryable.has(n))

  // Describe custom objects in parallel (batched to avoid rate limits)
  const batchSize = 10
  for (let i = 0; i < customObjectNames.length; i += batchSize) {
    const batch = customObjectNames.slice(i, i + batchSize)
    const descriptions = await Promise.all(
      batch.map(name => conn.describe(name).catch(() => null)),
    )

    for (const desc of descriptions) {
      if (!desc) continue

      customObjects.push({
        apiName: desc.name,
        label: desc.label,
        labelPlural: desc.labelPlural,
        custom: true,
        keyPrefix: desc.keyPrefix || '',
        queryable: desc.queryable,
        createable: desc.createable,
        updateable: desc.updateable,
        deletable: desc.deletable,
        fields: desc.fields.map((f: DescribeSObjectResult['fields'][0]) => mapField(f)),
        childRelationships: desc.childRelationships.map((cr: DescribeSObjectResult['childRelationships'][0]) => ({
          childSObject: cr.childSObject,
          field: cr.field,
          relationshipName: cr.relationshipName || null,
        })),
      })
    }
  }

  // Scan the selected standard objects for custom fields
  for (let i = 0; i < standardObjectNames.length; i += batchSize) {
    const batch = standardObjectNames.slice(i, i + batchSize)
    const descriptions = await Promise.all(
      batch.map(name => conn.describe(name).catch(() => null)),
    )

    for (const desc of descriptions) {
      if (!desc) continue

      const customFields = desc.fields
        .filter((f: DescribeSObjectResult['fields'][0]) => f.custom)
        .map((f: DescribeSObjectResult['fields'][0]) => mapField(f))

      if (customFields.length > 0) {
        standardObjectCustomFields.set(desc.name, customFields)
      }
    }
  }

  return {
    customObjects,
    standardObjectCustomFields,
    discoveredAt: new Date().toISOString(),
    orgId: conn.userInfo?.organizationId || '',
    apiVersion: conn.version || '59.0',
  }
}

function mapField(f: DescribeSObjectResult['fields'][0]): DiscoveredField {
  return {
    name: f.name,
    label: f.label,
    type: f.type,
    length: f.length || 0,
    nillable: f.nillable,
    createable: f.createable,
    updateable: f.updateable,
    defaultValue: f.defaultValue,
    picklistValues: (f.picklistValues || []).map((pv: {value: string; label: string; active: boolean; defaultValue: boolean}): PicklistValue => ({
      value: pv.value,
      label: pv.label,
      active: pv.active,
      defaultValue: pv.defaultValue,
    })),
    referenceTo: f.referenceTo || [],
    relationshipName: f.relationshipName || null,
    externalId: f.externalId || false,
    unique: f.unique || false,
    calculated: f.calculated || false,
  }
}

/**
 * Generate a human-readable command name from a Salesforce API name.
 * e.g., "Merchandise__c" → "merchandise", "myapp__Invoice__c" → "myapp-invoices"
 */
export function apiNameToCommandName(apiName: string): string {
  let name = apiName

  // Remove __c suffix
  name = name.replace(/__c$/, '')

  // Handle managed package prefix (namespace__)
  name = name.replace(/__/, '-')

  // Convert PascalCase to kebab-case
  name = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()

  return name
}

/**
 * Generate oclif flag definitions from discovered field metadata.
 */
export function fieldsToFlags(fields: DiscoveredField[]): Record<string, {type: string; options?: string[]; description: string}> {
  const flags: Record<string, {type: string; options?: string[]; description: string}> = {}

  for (const field of fields) {
    if (!field.createable && !field.updateable) continue
    if (field.name === 'Id') continue

    const flagName = field.name
      .replace(/__c$/, '')
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()

    const flagDef: {type: string; options?: string[]; description: string} = {
      type: mapFieldTypeToFlagType(field.type),
      description: field.label,
    }

    // Add picklist options as enum
    if (field.picklistValues.length > 0) {
      flagDef.options = field.picklistValues
        .filter(pv => pv.active)
        .map(pv => pv.value)
    }

    flags[flagName] = flagDef
  }

  return flags
}

function mapFieldTypeToFlagType(sfType: string): string {
  switch (sfType) {
  case 'boolean':
    return 'boolean'
  case 'int':
  case 'double':
  case 'currency':
  case 'percent':
    return 'integer'
  default:
    return 'string'
  }
}
