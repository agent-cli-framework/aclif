// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../../base.js'
import {projectRecord} from '../../../../../core/alias/alias-set.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataQuery extends ServiceNowBaseCommand {
  static override description = 'Query records from a ServiceNow table'

  static override aciExamples: CommandExample[] = [
    {
      description: 'List open P1 incidents',
      command: '$BIN servicenow data query --table incident --query "active=true^priority=1" --limit 10',
      responseShape: {table: 'incident', totalCount: 3, records: [{sys_id: 'abc...', number: 'INC001', short_description: 'Server down'}]},
    },
    {
      description: 'Get users with specific fields',
      command: '$BIN servicenow data query --table sys_user --fields "user_name,email,name" --limit 5',
    },
    {
      description: 'Query with display values and ordering',
      command: '$BIN servicenow data query --table change_request --query "state=2" --display-value true --order-by number',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Table API query results with record array',
    fields: {
      table: {type: 'string', description: 'Table queried'},
      query: {type: 'string', nullable: true, description: 'Encoded query used'},
      totalCount: {type: 'integer', nullable: true, description: 'Total matching records (from X-Total-Count header)'},
      records: {type: 'array', description: 'Array of table records'},
    },
    example: {table: 'incident', query: 'active=true', totalCount: 42, records: [{sys_id: 'abc123', number: 'INC0010001'}]},
  }

  static override flagCategories: FlagCategorization = {
    table: ['filtering'],
    query: ['filtering'],
    fields: ['output'],
    limit: ['filtering', 'pagination'],
    offset: ['pagination'],
    'order-by': ['pagination'],
    'display-value': ['output'],
    truncate: ['output'],
    json: ['output'],
    'instance-url': ['auth'],
    'access-token': ['auth'],
    'sn-username': ['auth'],
    'sn-password': ['auth'],
    'service-account': ['auth'],
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override flags = {
    ...ServiceNowBaseCommand.baseFlags,
    ...ServiceNowBaseCommand.canonicalFlags,
    table: Flags.string({
      description: 'ServiceNow table name (e.g., incident, sys_user, change_request)',
      required: true,
      char: 't',
    }),
    query: Flags.string({
      description: 'Encoded query string (e.g., "active=true^priority=1")',
      char: 'q',
    }),
    fields: Flags.string({
      description: 'Comma-separated fields to return (sysparm_fields)',
      char: 'f',
    }),
    limit: Flags.integer({
      description: 'Maximum records to return (sysparm_limit)',
      default: 100,
    }),
    offset: Flags.integer({
      description: 'Offset for pagination (sysparm_offset)',
    }),
    'order-by': Flags.string({
      description: 'Field to order by (prefix with ORDERBYDESC- for descending)',
    }),
    'display-value': Flags.string({
      description: 'Return display values: true, false, or all',
      options: ['true', 'false', 'all'],
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DataQuery)
    let table = flags.table
    let fieldsCsv = flags.fields
    let canon: Awaited<ReturnType<typeof this.resolveCanonical>> | undefined
    if (flags.canonical) {
      canon = await this.resolveCanonical(flags, table, fieldsCsv ? fieldsCsv.split(',').map((f) => f.trim()) : undefined)
      table = canon.entity
      fieldsCsv = canon.fields?.join(',')
    }

    const queryParams = {
      table: table,
      query: flags.query,
      fields: fieldsCsv,
      limit: flags.limit,
      offset: flags.offset,
      orderBy: flags['order-by'],
      displayValue: flags['display-value'],
    }

    if (this.isDryRun(flags, queryParams)) return

    try {
      const client = await this.getConnection()
      const response = await client.tableQuery(table, {
        sysparm_query: flags.query,
        sysparm_fields: fieldsCsv,
        sysparm_limit: flags.limit,
        sysparm_offset: flags.offset,
        sysparm_orderby: flags['order-by'],
        sysparm_display_value: flags['display-value'] as 'true' | 'false' | 'all' | undefined,
      })

      const hasMore = response.totalCount !== null
        ? (flags.offset || 0) + response.result.length < response.totalCount
        : response.result.length === flags.limit

      const nextOffset = (flags.offset || 0) + response.result.length
      const nextCommand = hasMore
        ? `$BIN servicenow data query --table ${table}${flags.query ? ` --query "${flags.query}"` : ''} --limit ${flags.limit} --offset ${nextOffset}`
        : null

      await this.outputResult({
        table,
        query: flags.query || null,
        totalCount: response.totalCount,
        records: canon ? response.result.map((r) => projectRecord(r as Record<string, unknown>, canon!.toCanonical)) : response.result,
      }, {...this.buildContext({
        returned: response.result.length,
        total: response.totalCount,
        hasMore,
        nextCommand,
        relatedCommands: [
          `$BIN servicenow data describe ${table}`,
          `$BIN servicenow discover --table ${table} --verbose`,
        ],
      }), ...(canon ? {canonical: canon.context} : {})})
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
