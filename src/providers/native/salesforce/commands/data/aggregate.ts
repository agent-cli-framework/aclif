// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataAggregate extends SalesforceBaseCommand {
  static override description = 'Execute SOQL aggregate queries (GROUP BY, HAVING, COUNT, SUM, AVG, etc.). IMPORTANT: Never use bare COUNT() with GROUP BY - use COUNT(Id) instead.'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Count opportunities by stage',
      command: '$BIN salesforce data aggregate Opportunity --select "StageName,COUNT(Id) OpCount" --group-by StageName',
      responseShape: {records: [{StageName: 'Prospecting', OpCount: 42}]},
    },
    {
      description: 'Revenue by year with threshold',
      command: '$BIN salesforce data aggregate Opportunity --select "CALENDAR_YEAR(CloseDate) Year,SUM(Amount) Revenue" --group-by "CALENDAR_YEAR(CloseDate)" --having "SUM(Amount) > 50000"',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Aggregate query results with grouped records',
    fields: {
      query: {type: 'string', description: 'The generated SOQL aggregate query'},
      totalSize: {type: 'integer', description: 'Number of grouped result rows'},
      records: {type: 'array', description: 'Grouped aggregate results'},
    },
    example: {query: 'SELECT StageName,COUNT(Id) FROM Opportunity GROUP BY StageName', totalSize: 5, records: [{StageName: 'Closed Won', expr0: 120}]},
  }

  static override flagCategories: FlagCategorization = {
    select: ['filtering'],
    'group-by': ['filtering'],
    where: ['filtering'],
    having: ['filtering'],
    'order-by': ['pagination'],
    limit: ['filtering', 'pagination'],
    fields: ['output'],
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

  static override args = {
    objectName: Args.string({
      description: 'Salesforce object to query',
      required: true,
    }),
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    select: Flags.string({
      description: 'Comma-separated select fields with aggregates (e.g., "StageName,COUNT(Id) OpCount")',
      required: true,
      char: 's',
    }),
    'group-by': Flags.string({
      description: 'Comma-separated GROUP BY fields',
      required: true,
    }),
    where: Flags.string({description: 'WHERE clause (no aggregates allowed)'}),
    having: Flags.string({description: 'HAVING clause (for aggregate filtering)'}),
    'order-by': Flags.string({description: 'ORDER BY clause'}),
    limit: Flags.integer({description: 'Maximum rows to return'}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args, flags} = await this.parse(DataAggregate)
    const {objectName} = args

    // Validate: WHERE must not contain aggregates
    const aggregateFunctions = ['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']
    if (flags.where) {
      const upperWhere = flags.where.toUpperCase()
      for (const fn of aggregateFunctions) {
        if (upperWhere.includes(`${fn}(`)) {
          this.error(`Aggregate function ${fn}() not allowed in WHERE clause. Use --having instead.`, {exit: 2})
        }
      }
    }

    // Auto-correct bare COUNT() to COUNT(Id) — COUNT() is invalid with GROUP BY
    flags.select = flags.select.replace(/\bCOUNT\(\s*\)/gi, 'COUNT(Id)')

    // Validate: all non-aggregate SELECT fields must be in GROUP BY
    const selectFields = flags.select.split(',').map(f => f.trim())
    const groupByFields = flags['group-by'].split(',').map(f => f.trim())
    const aggregatePattern = /^(COUNT|COUNT_DISTINCT|SUM|AVG|MIN|MAX)\(/i

    for (const field of selectFields) {
      if (!aggregatePattern.test(field) && !groupByFields.some(g =>
        g.toUpperCase() === field.toUpperCase() || field.toUpperCase().startsWith(g.toUpperCase()),
      )) {
        this.error(`Non-aggregate field "${field}" must appear in --group-by`, {exit: 2})
      }
    }

    // Build SOQL
    let soql = `SELECT ${flags.select} FROM ${objectName}`
    if (flags.where) soql += ` WHERE ${flags.where}`
    soql += ` GROUP BY ${flags['group-by']}`
    if (flags.having) soql += ` HAVING ${flags.having}`
    if (flags['order-by']) soql += ` ORDER BY ${flags['order-by']}`
    if (flags.limit) soql += ` LIMIT ${flags.limit}`

    if (this.isDryRun(flags, {soql})) return

    try {
      const conn = await this.getConnection()
      const result = await conn.query(soql)

      await this.outputResult({
        query: soql,
        totalSize: result.totalSize,
        records: result.records,
      }, this.buildContext({
        returned: result.records.length,
        total: result.totalSize,
        relatedCommands: [
          `$BIN salesforce data query --query "SELECT Id, Name FROM ${objectName} LIMIT 10"`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
