// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataSearch extends SalesforceBaseCommand {
  static override description = 'Execute a SOSL cross-object search'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Search across Account and Contact',
      command: '$BIN salesforce data search --query "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name)"',
      responseShape: {searchRecords: [{attributes: {type: 'Account'}, Id: '001xx...', Name: 'Acme Corp'}], totalResults: 3},
    },
    {
      description: 'Wildcard search in name fields',
      command: '$BIN salesforce data search --query "FIND {test*} IN NAME FIELDS RETURNING Account(Id, Name, Industry)"',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'SOSL cross-object search results',
    fields: {
      query: {type: 'string', description: 'The executed SOSL query'},
      searchRecords: {type: 'array', description: 'Matching records across objects'},
      totalResults: {type: 'integer', description: 'Total matching records'},
    },
    example: {query: 'FIND {Acme} RETURNING Account(Id,Name)', searchRecords: [{Id: '001xx...', Name: 'Acme'}], totalResults: 1},
  }

  static override flagCategories: FlagCategorization = {
    query: ['filtering'],
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
    ...SalesforceBaseCommand.baseFlags,
    query: Flags.string({
      description: 'SOSL query string',
      required: true,
      char: 'q',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DataSearch)

    if (this.isDryRun(flags, {query: flags.query})) return

    try {
      const conn = await this.getConnection()
      const result = await conn.search(flags.query)

      await this.outputResult({
        query: flags.query,
        searchRecords: result.searchRecords,
        totalResults: result.searchRecords?.length || 0,
      }, this.buildContext({
        returned: result.searchRecords?.length || 0,
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
