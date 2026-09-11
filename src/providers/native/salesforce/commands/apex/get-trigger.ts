// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, ResponseShape, CommandExample} from '../../../../../core/contract/aci.js'

/**
 * Read Apex trigger source code by name or pattern.
 *
 * Examples:
 *   aclif salesforce apex get-trigger --name AccountTrigger
 *   aclif salesforce apex get-trigger --pattern "Account*" --include-metadata
 */
export default class ApexGetTrigger extends SalesforceBaseCommand {
  static override description = 'Read Apex trigger source code by name or pattern'

  static override aciExamples: CommandExample[] = [
    {description: 'One trigger in full', command: '$BIN salesforce apex get-trigger --name AccountTrigger --json'},
    {description: 'List triggers matching a pattern with metadata', command: '$BIN salesforce apex get-trigger --pattern "Account*" --include-metadata --json'},
  ]

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "One trigger in full with --name, or a listing with --pattern",
    fields: {
      name: {type: "string", description: "with --name: trigger name"},
      object: {type: "string", description: "with --name: object the trigger is on"},
      apiVersion: {type: "string", description: "with --name"},
      status: {type: "string", description: "with --name: Active or Inactive"},
      isValid: {type: "boolean", description: "with --name"},
      lastModified: {type: "string", description: "with --name: ISO timestamp"},
      body: {type: "string", description: "with --name: Apex source"},
      pattern: {type: "string", description: "with --pattern: the pattern searched"},
      totalFound: {type: "number", description: "with --pattern: matches"},
      triggers: {type: "array", description: "with --pattern: [{name, object, status, apiVersion}]"},
    },
    example: {"name": "AccountTrigger", "object": "Account", "apiVersion": "59.0", "status": "Active", "isValid": true, "lastModified": "2026-09-11T00:00:00.000Z", "body": "trigger AccountTrigger on Account (before insert) { }"},
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    name: Flags.string({description: 'Exact trigger name', char: 'n'}),
    pattern: Flags.string({description: 'Name pattern with wildcards (* and ?)'}),
    'include-metadata': Flags.boolean({description: 'Include API version, status, and object info', default: false}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(ApexGetTrigger)

    if (!flags.name && !flags.pattern) {
      this.error('Either --name or --pattern is required', {exit: 2})
    }

    try {
      const conn = await this.getConnection()

      if (flags.name) {
        // Get specific trigger with full body
        const result = await conn.query(
          `SELECT Id, Name, Body, ApiVersion, TableEnumOrId, Status, IsValid, LastModifiedDate, LastModifiedById FROM ApexTrigger WHERE Name = '${flags.name}'`,
        )

        if (result.totalSize === 0) {
          this.outputError({code: 'NOT_FOUND', message: `Trigger "${flags.name}" not found`})
          return
        }

        const trigger = result.records[0] as Record<string, unknown>
        this.outputResult({
          name: trigger.Name,
          object: trigger.TableEnumOrId,
          apiVersion: trigger.ApiVersion,
          status: trigger.Status,
          isValid: trigger.IsValid,
          lastModified: trigger.LastModifiedDate,
          body: trigger.Body,
        })
      } else {
        // List triggers by pattern
        const likePattern = (flags.pattern || '').replace(/\*/g, '%').replace(/\?/g, '_')
        const selectFields = flags['include-metadata']
          ? 'Id, Name, ApiVersion, TableEnumOrId, Status, IsValid, LastModifiedDate'
          : 'Id, Name'

        const result = await conn.query(
          `SELECT ${selectFields} FROM ApexTrigger WHERE Name LIKE '${likePattern}' ORDER BY Name`,
        )

        this.outputResult({
          pattern: flags.pattern,
          totalFound: result.totalSize,
          triggers: result.records,
        }, this.buildContext({
          returned: result.records.length,
          total: result.totalSize,
          relatedCommands: result.records.length > 0
            ? [`$BIN salesforce apex get-trigger --name ${(result.records[0] as {Name: string}).Name}`]
            : [],
        }))
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
