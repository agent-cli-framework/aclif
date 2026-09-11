// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataQuery extends SalesforceBaseCommand {
  static override description = 'Execute a SOQL query against Salesforce'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'List 10 accounts',
      command: '$BIN salesforce data query --query "SELECT Id, Name FROM Account LIMIT 10"',
      responseShape: {totalSize: 10, done: true, records: [{Id: '001xx...', Name: 'Acme Corp'}]},
    },
    {
      description: 'Filter by industry with limit',
      command: '$BIN salesforce data query --query "SELECT Id, Name, Industry FROM Account WHERE Industry = \'Technology\'" --limit 5',
    },
    {
      description: 'Query with related fields',
      command: '$BIN salesforce data query --query "SELECT Id, Name, Account.Name FROM Contact LIMIT 5"',
    },
    {
      // Two Salesforce-specific traps packed into one example, both
      // easy to miss without seeing the actual response shape:
      //
      // 1. ``ORDER BY Cases DESC`` (alias) is rejected with
      //    INVALID_FIELD. The aggregate expression itself must appear
      //    in ORDER BY — ``ORDER BY COUNT(Id) DESC``.
      //
      // 2. A GROUP BY flattens relationship fields to their LEAF name
      //    at the top level of each record — ``GROUP BY Account.Name``
      //    returns ``{Name: "Acme Corp"}``, NOT
      //    ``{Account: {Name: "Acme Corp"}}``. This differs from the
      //    non-aggregate query shape and catches out every caller
      //    that flattens nested dicts the same way they would for a
      //    plain SELECT.
      description:
        'Top-N rows by aggregate count. Notes: (a) ORDER BY COUNT(Id), NOT ' +
        'the alias; (b) GROUP BY relationship fields come back flattened — ' +
        'Account.Name arrives as row.Name, not row.Account.Name.',
      command:
        '$BIN salesforce data query --query "SELECT Account.Name, COUNT(Id) Cases ' +
        'FROM Case WHERE Type = \'Warranty\' GROUP BY Account.Name ' +
        'ORDER BY COUNT(Id) DESC LIMIT 10"',
      responseShape: {
        totalSize: 10,
        done: true,
        records: [
          {
            attributes: {type: 'AggregateResult'},
            Name: 'Acme Corp',
            Cases: 42,
          },
        ],
      },
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'SOQL query results with record array',
    fields: {
      query: {type: 'string', description: 'The executed SOQL query'},
      totalSize: {type: 'integer', description: 'Total matching records'},
      done: {type: 'boolean', description: 'Whether all results returned (false if queryMore needed)'},
      records: {type: 'array', description: 'Array of SObject records with requested fields'},
    },
    example: {query: 'SELECT Id, Name FROM Account LIMIT 5', totalSize: 5, done: true, records: [{Id: '001xx000003GYRA', Name: 'Acme Corp'}]},
  }

  static override flagCategories: FlagCategorization = {
    query: ['filtering'],
    limit: ['filtering', 'pagination'],
    offset: ['pagination'],
    fields: ['output'],
    truncate: ['output'],
    json: ['output'],
    'instance-url': ['auth'],
    'access-token': ['auth'],
    'sf-username': ['auth'],
    'sf-password': ['auth'],
    'security-token': ['auth'],
    'client-id': ['auth'],
    'client-secret': ['auth'],
    'service-account': ['auth'],
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    query: Flags.string({
      description: 'SOQL query to execute',
      required: true,
      char: 'q',
    }),
    limit: Flags.integer({
      description: 'Override LIMIT in query (appended if not present)',
    }),
    offset: Flags.integer({
      description:
        'OFFSET into the result set (appended if not present). ' +
        'Salesforce caps OFFSET at 2000; consumers needing deeper ' +
        'pagination should narrow the scope_predicate.',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DataQuery)
    let soql = flags.query

    // Append LIMIT if provided and not already in query
    if (flags.limit && !/\bLIMIT\b/i.test(soql)) {
      soql += ` LIMIT ${flags.limit}`
    }
    // Append OFFSET if provided and not already in query. SOQL parses OFFSET
    // after LIMIT, so an OFFSET clause is appended at the tail.
    if (flags.offset && !/\bOFFSET\b/i.test(soql)) {
      soql += ` OFFSET ${flags.offset}`
    }

    if (this.isDryRun(flags, {query: soql})) return

    try {
      const conn = await this.getConnection()
      const result = await conn.query(soql)

      // Build nextCommand for paginating callers. SOQL supports OFFSET
      // directly (server-capped at 2000) so we expose a uniform
      // `--offset N` follow-up rather than a queryLocator. The next
      // OFFSET is the current OFFSET plus what we returned this page.
      const currentOffset = flags.offset ?? 0
      const nextOffset = currentOffset + result.records.length
      const hasMore = !result.done && nextOffset < 2000
      // Reconstruct the original (un-offset) SOQL for the nextCommand so
      // we don't compound OFFSET clauses when the caller paginates.
      const baseSoql = flags.query
      const escapedQuery = baseSoql.replace(/"/g, '\\"')
      const nextCommand = hasMore
        ? `$BIN salesforce data query --query "${escapedQuery}"` +
          (flags.limit ? ` --limit ${flags.limit}` : '') +
          ` --offset ${nextOffset}`
        : null

      await this.outputResult({
        query: soql,
        totalSize: result.totalSize,
        done: result.done,
        records: result.records,
      }, this.buildContext({
        returned: result.records.length,
        total: result.totalSize,
        hasMore,
        nextCommand,
        relatedCommands: [
          `$BIN salesforce discover --object ${soql.match(/FROM\s+(\w+)/i)?.[1] || 'Account'} --verbose`,
        ],
      }))
    } catch (error) {
      // Pass the SOQL so formatError can refine generic INVALID_FIELD
      // messages into the specific ORDER-BY-alias trap when relevant.
      this.outputError(this.formatError(error, {query: soql}))
    }
  }
}
