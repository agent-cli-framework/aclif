// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataSearch extends ServiceNowBaseCommand {
  static override description = 'Search for records in a ServiceNow table using text matching'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Search incidents for network issues',
      command: '$BIN servicenow data search --table incident --text "network outage"',
      responseShape: {table: 'incident', searchText: 'network outage', totalCount: 7, records: [{sys_id: 'abc...', short_description: 'Network outage in DC1'}]},
    },
    {
      description: 'Search knowledge base with custom fields',
      command: '$BIN servicenow data search --table kb_knowledge --text "password reset" --search-fields short_description,text --limit 20',
    },
    {
      description: 'Search users by name/email',
      command: '$BIN servicenow data search --table sys_user --text "john" --search-fields name,email,user_name',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Text search results using LIKE query across specified fields',
    fields: {
      table: {type: 'string', description: 'Table searched'},
      searchText: {type: 'string', description: 'Text searched for'},
      searchFields: {type: 'array', description: 'Fields searched in'},
      encodedQuery: {type: 'string', description: 'Generated encoded query'},
      totalCount: {type: 'integer', nullable: true, description: 'Total matching records'},
      records: {type: 'array', description: 'Matching records'},
    },
    example: {table: 'incident', searchText: 'outage', totalCount: 3, records: [{sys_id: 'abc123'}]},
  }

  static override flagCategories: FlagCategorization = {
    table: ['filtering'],
    text: ['filtering'],
    'search-fields': ['filtering'],
    fields: ['output'],
    limit: ['filtering', 'pagination'],
    'display-value': ['output'],
    json: ['output'],
    'instance-url': ['auth'],
    'access-token': ['auth'],
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
    table: Flags.string({
      description: 'ServiceNow table name',
      required: true,
      char: 't',
    }),
    text: Flags.string({
      description: 'Text to search for',
      required: true,
    }),
    'search-fields': Flags.string({
      description: 'Comma-separated fields to search in (default: short_description,description,name)',
    }),
    fields: Flags.string({
      description: 'Comma-separated fields to return in results',
      char: 'f',
    }),
    limit: Flags.integer({
      description: 'Maximum records to return',
      default: 50,
    }),
    'display-value': Flags.string({
      description: 'Return display values: true, false, or all',
      options: ['true', 'false', 'all'],
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DataSearch)

    const searchFields = flags['search-fields']
      ? flags['search-fields'].split(',').map(f => f.trim())
      : ['short_description', 'description', 'name']

    // Build encoded query with LIKE operator across search fields
    const queryParts = searchFields.map(field => `${field}LIKE${flags.text}`)
    const encodedQuery = queryParts.join('^OR')

    if (this.isDryRun(flags, {table: flags.table, text: flags.text, searchFields, encodedQuery})) return

    try {
      const client = await this.getConnection()
      const response = await client.tableQuery(flags.table, {
        sysparm_query: encodedQuery,
        sysparm_fields: flags.fields,
        sysparm_limit: flags.limit,
        sysparm_display_value: flags['display-value'] as 'true' | 'false' | 'all' | undefined,
      })

      await this.outputResult({
        table: flags.table,
        searchText: flags.text,
        searchFields,
        encodedQuery,
        totalCount: response.totalCount,
        records: response.result,
      }, this.buildContext({
        returned: response.result.length,
        total: response.totalCount,
        hasMore: response.totalCount !== null ? response.result.length < response.totalCount : response.result.length === flags.limit,
        relatedCommands: [
          `$BIN servicenow data query --table ${flags.table} --query "${encodedQuery}" --json`,
          `$BIN servicenow data describe ${flags.table} --json`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
