// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataSearchObjects extends SalesforceBaseCommand {
  static override description = 'Search for Salesforce objects by name pattern'

  static override aciExamples: CommandExample[] = [
    {
      description: 'List all custom objects',
      command: '$BIN salesforce data search-objects --pattern "*__c" --custom-only',
      responseShape: {totalMatched: 5, objects: [{name: 'Merchandise__c', label: 'Merchandise', custom: true}]},
    },
    {
      description: 'Find objects matching a pattern',
      command: '$BIN salesforce data search-objects --pattern "Account*" --queryable-only',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'List of Salesforce objects matching the pattern',
    fields: {
      pattern: {type: 'string', description: 'Search pattern used'},
      totalMatched: {type: 'integer', description: 'Number of matching objects'},
      objects: {type: 'array', description: 'Matching objects with name, label, custom, queryable flags'},
    },
    example: {pattern: '*__c', totalMatched: 3, objects: [{name: 'Merchandise__c', label: 'Merchandise', custom: true, queryable: true}]},
  }

  static override flagCategories: FlagCategorization = {
    pattern: ['filtering'],
    'queryable-only': ['filtering'],
    'custom-only': ['filtering'],
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
    pattern: Flags.string({description: 'Name pattern with wildcards (* and ?)', default: '*'}),
    'queryable-only': Flags.boolean({description: 'Only show queryable objects', default: false}),
    'custom-only': Flags.boolean({description: 'Only show custom objects', default: false}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DataSearchObjects)

    try {
      const conn = await this.getConnection()
      const globalDesc = await conn.describeGlobal()

      const regex = new RegExp(
        '^' + (flags.pattern || '*').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        'i',
      )

      let objects = globalDesc.sobjects.filter((obj: {name: string}) => regex.test(obj.name))

      if (flags['queryable-only']) {
        objects = objects.filter((obj: {queryable: boolean}) => obj.queryable)
      }

      if (flags['custom-only']) {
        objects = objects.filter((obj: {custom: boolean}) => obj.custom)
      }

      await this.outputResult({
        pattern: flags.pattern,
        totalMatched: objects.length,
        objects: objects.map((obj: Record<string, unknown>) => ({
          name: obj.name,
          label: obj.label,
          custom: obj.custom,
          queryable: obj.queryable,
          createable: obj.createable,
          keyPrefix: obj.keyPrefix,
        })),
      }, this.buildContext({
        returned: objects.length,
        total: globalDesc.sobjects.length,
        relatedCommands: objects.length > 0
          ? [`$BIN salesforce data describe ${(objects[0] as {name: string}).name}`]
          : [],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
