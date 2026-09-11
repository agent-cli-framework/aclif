// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {ServiceNowClient} from './client.js'
import type {DiscoveredField, DiscoveredObject, PicklistValue} from '../../../core/contract/aci.js'

/**
 * Deploy-time schema discovery for ServiceNow tables.
 * Discovers tables via sys_db_object and fields via sys_dictionary.
 */

export interface ServiceNowDiscoveryResult {
  tables: DiscoveredObject[]
  discoveredAt: string
  instanceUrl: string
}

/** Common ServiceNow tables to discover by default */
const DEFAULT_TABLES = [
  'incident', 'problem', 'change_request', 'change_task',
  'sys_user', 'sys_user_group', 'cmdb_ci', 'cmdb_ci_server',
  'sc_req_item', 'sc_request', 'sc_task',
  'kb_knowledge', 'kb_category', 'task',
]

/**
 * Discover all tables and their fields in a ServiceNow instance.
 */
export interface ServiceNowDiscoveryOptions {
  /** Describe exactly these tables. */
  tables?: string[]
  /** Every table with an update name: custom, scoped, and platform. */
  includeCustom?: boolean
  /** Add the custom (u_ and x_) tables to the default core set; the tenant walk's default (C-TEN-3). */
  withCustomTables?: boolean
}

export async function discoverServiceNowSchema(
  client: ServiceNowClient,
  options?: ServiceNowDiscoveryOptions,
): Promise<ServiceNowDiscoveryResult> {
  const tables: DiscoveredObject[] = []

  // If specific tables requested, describe those; otherwise discover from sys_db_object
  let tableNames: string[]

  if (options?.tables && options.tables.length > 0) {
    tableNames = options.tables
  } else {
    // Fetch table list from sys_db_object
    const core = `nameIN${DEFAULT_TABLES.join(',')}`
    const query = options?.includeCustom
      ? 'sys_update_nameISNOTEMPTY'
      : options?.withCustomTables
        ? `${core}^ORnameSTARTSWITHu_^ORnameSTARTSWITHx_`
        : core

    const tableList = await client.listTables(query)
    tableNames = tableList.result.map((t: Record<string, unknown>) => t.name as string)
  }

  // Describe tables in parallel batches (batch size 5 for ServiceNow rate limits)
  const batchSize = 5
  for (let i = 0; i < tableNames.length; i += batchSize) {
    const batch = tableNames.slice(i, i + batchSize)
    const descriptions = await Promise.all(
      batch.map(name => describeServiceNowTable(client, name).catch(() => null)),
    )

    for (const desc of descriptions) {
      if (desc) tables.push(desc)
    }
  }

  return {
    tables,
    discoveredAt: new Date().toISOString(),
    instanceUrl: client.instanceUrl,
  }
}

/**
 * Describe a single ServiceNow table's fields via sys_dictionary.
 *
 * Also returns the table-extension chain (most-derived first) so the
 * caller can query sys_choice with the same hierarchy — choice rows
 * for inherited fields live under the *parent* table's name, so the
 * chain is required to find them.
 */
export async function describeServiceNowTable(
  client: ServiceNowClient,
  tableName: string,
): Promise<DiscoveredObject & {tableChain: string[]}> {
  const [hierarchy, response] = await Promise.all([
    client.getTableHierarchy(tableName),
    client.describeTable(tableName),
  ])
  const fields: DiscoveredField[] = response.result.map(mapDictionaryField)
  const tableChain = hierarchy.length > 0 ? hierarchy : [tableName]

  return {
    apiName: tableName,
    label: tableName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    labelPlural: tableName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    custom: tableName.startsWith('u_') || tableName.startsWith('x_'),
    keyPrefix: '', // ServiceNow uses sys_id universally
    queryable: true,
    createable: true,
    updateable: true,
    deletable: true,
    fields,
    childRelationships: [], // Populated separately if needed
    tableChain,
  }
}

/**
 * Get choice/picklist values for a specific field.
 *
 * ``tableOrChain`` may be a single table name or the table-extension
 * chain returned by ``describeServiceNowTable``. Inherited fields
 * (e.g. ``state`` on ``incident``) have their choices declared on the
 * parent table, so passing the full chain is required to find them.
 */
export async function getFieldChoices(
  client: ServiceNowClient,
  tableOrChain: string | string[],
  fieldName: string,
): Promise<PicklistValue[]> {
  const response = await client.getChoices(tableOrChain, fieldName)
  return response.result.map((c: Record<string, unknown>) => ({
    value: (c.value as string) || '',
    label: (c.label as string) || '',
    active: c.inactive !== 'true',
    defaultValue: false,
  }))
}

function mapDictionaryField(dictEntry: Record<string, unknown>): DiscoveredField {
  const internalType = (dictEntry.internal_type as string) || 'string'

  // ServiceNow stores state/priority/severity and similar dropdowns as
  // ``integer`` fields whose valid values live in ``sys_choice``. The
  // sys_dictionary ``choice`` column marks those fields:
  //   "0" → no choice list
  //   "1" → suggestion (free-form with suggestions)
  //   "2" → dropdown only
  //   "3" → suggestion with list
  // Any non-zero value means there's a choice list worth fetching, so
  // we promote the field to ``picklist`` regardless of its scalar
  // internal_type. Downstream callers (the form builder, the describe
  // command's choice-fetch loop) key off ``type === 'picklist'``, so
  // this single flip is enough to turn state/priority/severity into
  // real dropdowns instead of open number inputs.
  const choiceFlag = String(dictEntry.choice ?? '0')
  const hasChoiceList = choiceFlag !== '' && choiceFlag !== '0'
  const mappedType = hasChoiceList ? 'picklist' : mapServiceNowType(internalType)

  return {
    name: (dictEntry.element as string) || '',
    label: (dictEntry.column_label as string) || '',
    type: mappedType,
    length: parseInt((dictEntry.max_length as string) || '0', 10),
    nillable: dictEntry.mandatory !== 'true',
    createable: dictEntry.read_only !== 'true',
    updateable: dictEntry.read_only !== 'true',
    defaultValue: dictEntry.default_value ?? null,
    picklistValues: [], // Populated separately via getFieldChoices if needed
    referenceTo: dictEntry.reference ? [dictEntry.reference as string] : [],
    relationshipName: dictEntry.reference ? (dictEntry.element as string) : null,
    externalId: false,
    unique: false,
    calculated: false,
  }
}

function mapServiceNowType(internalType: string): string {
  switch (internalType) {
  case 'integer':
  case 'decimal':
  case 'float':
  case 'numeric':
    return 'number'
  case 'boolean':
  case 'true_false':
    return 'boolean'
  case 'glide_date':
  case 'glide_date_time':
  case 'due_date':
    return 'datetime'
  case 'reference':
    return 'reference'
  case 'choice':
  case 'choicelist':
    return 'picklist'
  case 'journal':
  case 'journal_input':
  case 'html':
    return 'textarea'
  default:
    return 'string'
  }
}
