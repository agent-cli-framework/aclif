// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample} from '../../../../../core/contract/aci.js'

/**
 * Create or update Apex triggers via the Tooling API.
 *
 * Examples:
 *   aclif salesforce apex deploy-trigger --name AccountTrigger --object Account --body "trigger AccountTrigger on Account (before insert) { }"
 *   aclif salesforce apex deploy-trigger --name AccountTrigger --body "trigger AccountTrigger on Account (before insert, after update) { }" --update
 */
export default class ApexDeployTrigger extends SalesforceBaseCommand {
  static override description = 'Create or update Apex triggers via Tooling API'

  static override aciExamples: CommandExample[] = [
    {description: 'Create a before-insert trigger', command: '$BIN salesforce apex deploy-trigger --name AccountTrigger --object Account --body "trigger AccountTrigger on Account (before insert) { }" --json'},
    {description: 'Update an existing trigger body', command: '$BIN salesforce apex deploy-trigger --name AccountTrigger --body "trigger AccountTrigger on Account (before insert, before update) { }" --update --json'},
    {description: 'Preview without deploying', command: '$BIN salesforce apex deploy-trigger --name AccountTrigger --object Account --body "trigger AccountTrigger on Account (before insert) { }" --dry-run'},
  ]

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 2,
    requiresConfirmation: false,
    prerequisites: [],
    capabilities: ['metadata_change'],
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    name: Flags.string({description: 'Trigger name', required: true, char: 'n'}),
    object: Flags.string({description: 'Object API name (required for create)', char: 'o'}),
    body: Flags.string({description: 'Apex trigger source code', required: true}),
    'api-version': Flags.string({description: 'Apex API version', default: '59.0'}),
    update: Flags.boolean({description: 'Update existing trigger instead of creating', default: false}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(ApexDeployTrigger)

    // Validate trigger name in body
    const nameRegex = new RegExp(`\\btrigger\\s+${flags.name}\\b`, 'i')
    if (!nameRegex.test(flags.body)) {
      this.error(`Trigger name "${flags.name}" not found in body. The body must contain "trigger ${flags.name} on ..."`, {exit: 2})
    }

    if (this.isDryRun(flags, {
      operation: flags.update ? 'update' : 'create',
      triggerName: flags.name,
      object: flags.object,
      bodyLength: flags.body.length,
    })) return

    try {
      const conn = await this.getConnection()

      if (flags.update) {
        // Find existing trigger
        const existing = await conn.query(
          `SELECT Id, Name FROM ApexTrigger WHERE Name = '${flags.name}'`,
        )
        if (existing.totalSize === 0) {
          this.error(`Trigger "${flags.name}" not found. Remove --update to create it.`, {exit: 1})
        }

        const triggerId = (existing.records[0] as {Id: string}).Id
        const result = await conn.tooling.sobject('ApexTrigger').update({
          Id: triggerId,
          Body: flags.body,
        })

        if (result.success) {
          // Fetch updated details
          const updated = await conn.query(
            `SELECT Id, Name, TableEnumOrId, ApiVersion, Status, LastModifiedDate FROM ApexTrigger WHERE Id = '${triggerId}'`,
          )
          const trigger = updated.records[0] as Record<string, unknown>
          this.outputResult({
            operation: 'update',
            id: triggerId,
            name: trigger.Name,
            object: trigger.TableEnumOrId,
            apiVersion: trigger.ApiVersion,
            status: trigger.Status,
            lastModified: trigger.LastModifiedDate,
          })
        } else {
          this.outputError({code: 'UPDATE_FAILED', message: `Failed to update trigger: ${JSON.stringify(result)}`})
        }
      } else {
        // Create new trigger
        if (!flags.object) {
          this.error('--object is required when creating a new trigger', {exit: 2})
        }

        // Validate object name in body
        const objectRegex = new RegExp(`\\bon\\s+${flags.object}\\b`, 'i')
        if (!objectRegex.test(flags.body)) {
          this.error(`Object "${flags.object}" not found in trigger body. Expected "trigger ${flags.name} on ${flags.object} ..."`, {exit: 2})
        }

        // Check if trigger already exists
        const existing = await conn.query(
          `SELECT Id FROM ApexTrigger WHERE Name = '${flags.name}'`,
        )
        if (existing.totalSize > 0) {
          this.error(`Trigger "${flags.name}" already exists. Use --update to modify it.`, {exit: 1})
        }

        const result = await conn.tooling.sobject('ApexTrigger').create({
          Name: flags.name,
          TableEnumOrId: flags.object,
          Body: flags.body,
          ApiVersion: flags['api-version'],
          Status: 'Active',
        })

        if (result.success) {
          this.outputResult({
            operation: 'create',
            id: result.id,
            name: flags.name,
            object: flags.object,
            apiVersion: flags['api-version'],
            status: 'Active',
          })
        } else {
          this.outputError({code: 'CREATE_FAILED', message: `Failed to create trigger: ${JSON.stringify(result)}`})
        }
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
