// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataAggregate extends ServiceNowBaseCommand {
  static override description = 'Get aggregate statistics from a ServiceNow table'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Count incidents by priority',
      command: '$BIN servicenow data aggregate --table incident --count --group-by priority',
      responseShape: {records: [{priority: '1', count: 12}]},
    },
    {
      description: 'Average reassignment count by category',
      command: '$BIN servicenow data aggregate --table incident --query "active=true" --avg reassignment_count --group-by category',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Aggregate statistics grouped by specified fields, normalized to flat records',
    fields: {
      table: {type: 'string', description: 'Table queried'},
      query: {type: 'string', nullable: true, description: 'Encoded query filter used'},
      groupBy: {type: 'string', nullable: true, description: 'Group-by field'},
      records: {type: 'array', description: 'Flat records with group-by fields and stats as columns'},
    },
    example: {table: 'incident', query: null, groupBy: 'priority', records: [{priority: '1', count: 12}]},
  }

  static override flagCategories: FlagCategorization = {
    table: ['filtering'],
    query: ['filtering'],
    'group-by': ['filtering'],
    count: ['filtering'],
    avg: ['filtering'],
    sum: ['filtering'],
    min: ['filtering'],
    max: ['filtering'],
    having: ['filtering'],
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
    query: Flags.string({
      description: 'Encoded query filter',
      char: 'q',
    }),
    'group-by': Flags.string({
      description: 'Field(s) to group by (comma-separated)',
    }),
    count: Flags.boolean({
      description: 'Include record count',
      default: false,
    }),
    avg: Flags.string({
      description: 'Field(s) to average (comma-separated)',
    }),
    sum: Flags.string({
      description: 'Field(s) to sum (comma-separated)',
    }),
    min: Flags.string({
      description: 'Field(s) to get minimum (comma-separated)',
    }),
    max: Flags.string({
      description: 'Field(s) to get maximum (comma-separated)',
    }),
    having: Flags.string({
      description: 'Having clause for group filtering (e.g., "count>5")',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DataAggregate)

    if (!flags.count && !flags.avg && !flags.sum && !flags.min && !flags.max) {
      this.error('At least one aggregate function is required: --count, --avg, --sum, --min, or --max', {exit: 2})
    }

    const params = {
      table: flags.table,
      query: flags.query,
      groupBy: flags['group-by'],
      count: flags.count,
      avg: flags.avg,
      sum: flags.sum,
      min: flags.min,
      max: flags.max,
      having: flags.having,
    }

    if (this.isDryRun(flags, params)) return

    try {
      const client = await this.getConnection()
      const response = await client.aggregate(flags.table, {
        sysparm_query: flags.query,
        sysparm_group_by: flags['group-by'],
        sysparm_count: flags.count ? 'true' : undefined,
        sysparm_avg_fields: flags.avg,
        sysparm_sum_fields: flags.sum,
        sysparm_min_fields: flags.min,
        sysparm_max_fields: flags.max,
        sysparm_having: flags.having,
      })

      // Normalize aggregates into flat records format (matching Salesforce
      // aggregate output) so the A2UI renderer can display tables and charts
      // without special-casing ServiceNow's nested structure.
      const aggregates = Array.isArray(response.result) ? response.result : []
      const records = aggregates.map((agg: Record<string, unknown>) => {
        const record: Record<string, unknown> = {}
        // Flatten groupby fields: [{field: "priority", value: "1"}] → {priority: "1"}
        const groupbyFields = agg.groupby_fields as Array<{field: string; value: string}> | undefined
        if (groupbyFields) {
          for (const gf of groupbyFields) {
            record[gf.field] = gf.value
          }
        }

        // Flatten stats: {count: "27"} → {count: 27}
        const stats = agg.stats as Record<string, string> | undefined
        if (stats) {
          for (const [key, value] of Object.entries(stats)) {
            record[key] = Number(value) || value
          }
        }

        return record
      })

      await this.outputResult({
        table: flags.table,
        query: flags.query || null,
        groupBy: flags['group-by'] || null,
        records,
      }, this.buildContext({
        returned: records.length,
        relatedCommands: [
          `$BIN servicenow data query --table ${flags.table}${flags.query ? ` --query "${flags.query}"` : ''} --limit 10 --json`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
