// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata} from '../../../../../core/contract/aci.js'

/**
 * Create or update custom Salesforce objects via the Metadata API.
 *
 * Examples:
 *   aclif salesforce metadata object create MyObject --label "My Object" --plural-label "My Objects"
 *   aclif salesforce metadata object update MyObject --description "Updated description"
 */
export default class MetadataObject extends SalesforceBaseCommand {
  static override description = 'Create or update custom Salesforce objects via Metadata API'

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

  static override args = {
    operation: Args.string({
      description: 'Operation to perform',
      required: true,
      options: ['create', 'update'],
    }),
    objectName: Args.string({
      description: 'Object API name (without __c suffix)',
      required: true,
    }),
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    label: Flags.string({description: 'Object label'}),
    'plural-label': Flags.string({description: 'Object plural label'}),
    description: Flags.string({description: 'Object description'}),
    'name-field-label': Flags.string({description: 'Custom name field label'}),
    'name-field-type': Flags.string({
      description: 'Name field type',
      options: ['Text', 'AutoNumber'],
      default: 'Text',
    }),
    'name-field-format': Flags.string({description: 'AutoNumber format (e.g., A-{0000})'}),
    'sharing-model': Flags.string({
      description: 'Sharing model',
      options: ['ReadWrite', 'Read', 'Private', 'ControlledByParent'],
      default: 'ReadWrite',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {args, flags} = await this.parse(MetadataObject)
    const {operation, objectName} = args
    const fullName = `${objectName}__c`

    // Dry-run check
    if (this.isDryRun(flags, {operation, objectName: fullName, label: flags.label})) return

    try {
      const conn = await this.getConnection()

      if (operation === 'create') {
        if (!flags.label) {
          this.error('--label is required for create operation', {exit: 2})
        }

        const nameField: Record<string, unknown> = {
          label: flags['name-field-label'] || `${flags.label} Name`,
          type: flags['name-field-type'] || 'Text',
        }
        if (flags['name-field-type'] === 'AutoNumber' && flags['name-field-format']) {
          nameField.displayFormat = flags['name-field-format']
        }

        const metadata = {
          fullName,
          label: flags.label,
          pluralLabel: flags['plural-label'] || `${flags.label}s`,
          nameField,
          deploymentStatus: 'Deployed',
          sharingModel: flags['sharing-model'] || 'ReadWrite',
          description: flags.description,
        }

        const result = await conn.metadata.create('CustomObject', metadata)
        const res = Array.isArray(result) ? result[0] : result

        if (res.success) {
          this.outputResult({
            operation: 'create',
            objectName: fullName,
            label: flags.label,
            status: 'Created',
          }, this.buildContext({
            relatedCommands: [
              `$BIN salesforce metadata field create ${objectName} --field-name <name> --type Text`,
              `$BIN salesforce data query --query "SELECT Id FROM ${fullName} LIMIT 1"`,
            ],
          }))
        } else {
          this.outputError({code: 'CREATE_FAILED', message: `Failed to create object: ${JSON.stringify(res)}`})
        }
      } else {
        // Update: read existing, merge changes
        const existing = await conn.metadata.read('CustomObject', [fullName])
        const current = Array.isArray(existing) ? existing[0] : existing

        const metadata: Record<string, unknown> = {fullName}
        if (flags.label) metadata.label = flags.label
        if (flags['plural-label']) metadata.pluralLabel = flags['plural-label']
        if (flags.description) metadata.description = flags.description
        if (flags['sharing-model']) metadata.sharingModel = flags['sharing-model']

        const result = await conn.metadata.update('CustomObject', metadata)
        const res = Array.isArray(result) ? result[0] : result

        if (res.success) {
          this.outputResult({operation: 'update', objectName: fullName, updatedFields: Object.keys(metadata).filter(k => k !== 'fullName')})
        } else {
          this.outputError({code: 'UPDATE_FAILED', message: `Failed to update object: ${JSON.stringify(res)}`})
        }
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
