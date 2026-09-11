// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../../../../core/contract/aci.js'

export default class ApexGetClass extends SalesforceBaseCommand {
  static override description = 'Read Apex class source code by name or pattern'

  static override aciExamples: CommandExample[] = [
    {description: 'Get class by name', command: '$BIN salesforce apex get-class --name MyController'},
    {description: 'Search by pattern', command: '$BIN salesforce apex get-class --pattern "Account*" --include-metadata'},
  ]

  static override responseShape: ResponseShape = {
    description: 'Apex class source code and metadata',
    fields: {
      name: {type: 'string', description: 'Class name'},
      body: {type: 'string', description: 'Source code'},
      apiVersion: {type: 'string', description: 'API version'},
      status: {type: 'string', description: 'Active/Deleted'},
    },
    example: {name: 'MyController', apiVersion: '59.0', status: 'Active', body: 'public class MyController { }'},
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    name: Flags.string({description: 'Exact class name', char: 'n'}),
    pattern: Flags.string({description: 'Name pattern with wildcards (* and ?)'}),
    'include-metadata': Flags.boolean({description: 'Include API version, status, and size', default: false}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(ApexGetClass)

    if (!flags.name && !flags.pattern) {
      this.error('Either --name or --pattern is required', {exit: 2})
    }

    try {
      const conn = await this.getConnection()

      if (flags.name) {
        const result = await conn.query(
          `SELECT Id, Name, Body, ApiVersion, Status, LengthWithoutComments, LastModifiedDate, LastModifiedById FROM ApexClass WHERE Name = '${flags.name}'`,
        )

        if (result.totalSize === 0) {
          this.outputError({code: 'NOT_FOUND', message: `Apex class "${flags.name}" not found`})
          return
        }

        const cls = result.records[0] as Record<string, unknown>
        this.outputResult({
          name: cls.Name,
          apiVersion: cls.ApiVersion,
          status: cls.Status,
          length: cls.LengthWithoutComments,
          lastModified: cls.LastModifiedDate,
          body: cls.Body,
        })
      } else {
        const likePattern = (flags.pattern || '').replace(/\*/g, '%').replace(/\?/g, '_')
        const selectFields = flags['include-metadata']
          ? 'Id, Name, ApiVersion, Status, LengthWithoutComments, LastModifiedDate'
          : 'Id, Name'

        const result = await conn.query(
          `SELECT ${selectFields} FROM ApexClass WHERE Name LIKE '${likePattern}' ORDER BY Name`,
        )

        this.outputResult({
          pattern: flags.pattern,
          totalFound: result.totalSize,
          classes: result.records,
        }, this.buildContext({
          returned: result.records.length,
          total: result.totalSize,
          relatedCommands: result.records.length > 0
            ? [`$BIN salesforce apex get-class --name ${(result.records[0] as {Name: string}).Name}`]
            : [],
        }))
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
