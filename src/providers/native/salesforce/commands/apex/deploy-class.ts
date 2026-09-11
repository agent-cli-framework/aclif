// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata} from '../../../../../core/contract/aci.js'

/**
 * Create or update Apex classes via the Tooling API.
 *
 * Examples:
 *   aclif salesforce apex deploy-class --name MyController --body "public class MyController { }"
 *   aclif salesforce apex deploy-class --name MyController --body "public class MyController { public String hello() { return 'world'; } }" --update
 */
export default class ApexDeployClass extends SalesforceBaseCommand {
  static override description = 'Create or update Apex classes via Tooling API'

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
    name: Flags.string({description: 'Class name', required: true, char: 'n'}),
    body: Flags.string({description: 'Apex class source code', required: true}),
    'api-version': Flags.string({description: 'Apex API version', default: '59.0'}),
    update: Flags.boolean({description: 'Update existing class instead of creating', default: false}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(ApexDeployClass)

    if (this.isDryRun(flags, {
      operation: flags.update ? 'update' : 'create',
      className: flags.name,
      bodyLength: flags.body.length,
    })) return

    try {
      const conn = await this.getConnection()

      if (flags.update) {
        // Find existing class
        const existing = await conn.query(
          `SELECT Id FROM ApexClass WHERE Name = '${flags.name}'`,
        )
        if (existing.totalSize === 0) {
          this.error(`Apex class "${flags.name}" not found. Remove --update to create it.`, {exit: 1})
        }

        const classId = (existing.records[0] as {Id: string}).Id
        const result = await conn.tooling.sobject('ApexClass').update({
          Id: classId,
          Body: flags.body,
        })

        if (result.success) {
          const updated = await conn.query(
            `SELECT Id, Name, ApiVersion, Status, LastModifiedDate FROM ApexClass WHERE Id = '${classId}'`,
          )
          this.outputResult({
            operation: 'update',
            ...(updated.records[0] as Record<string, unknown>),
          })
        } else {
          this.outputError({code: 'UPDATE_FAILED', message: `Failed to update class: ${JSON.stringify(result)}`})
        }
      } else {
        // Check if class already exists
        const existing = await conn.query(
          `SELECT Id FROM ApexClass WHERE Name = '${flags.name}'`,
        )
        if (existing.totalSize > 0) {
          this.error(`Apex class "${flags.name}" already exists. Use --update to modify it.`, {exit: 1})
        }

        const result = await conn.tooling.sobject('ApexClass').create({
          Name: flags.name,
          Body: flags.body,
          ApiVersion: flags['api-version'],
          Status: 'Active',
        })

        if (result.success) {
          this.outputResult({
            operation: 'create',
            id: result.id,
            name: flags.name,
            apiVersion: flags['api-version'],
            status: 'Active',
          })
        } else {
          this.outputError({code: 'CREATE_FAILED', message: `Failed to create class: ${JSON.stringify(result)}`})
        }
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
