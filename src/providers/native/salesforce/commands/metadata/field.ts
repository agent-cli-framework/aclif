// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'
import type {Connection} from 'jsforce'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata} from '../../../../../core/contract/aci.js'

const FIELD_TYPES = [
  'Checkbox', 'Currency', 'Date', 'DateTime', 'Email', 'Number', 'Percent',
  'Phone', 'Picklist', 'MultiselectPicklist', 'Text', 'TextArea', 'LongTextArea',
  'Html', 'Url', 'Lookup', 'MasterDetail',
]

/**
 * Create or update custom fields on Salesforce objects via Metadata API.
 * Automatically grants Field Level Security to specified profiles.
 *
 * Examples:
 *   aclif salesforce metadata field create Account --field-name Revenue_Tier --type Picklist --picklist-values "Low,Medium,High"
 *   aclif salesforce metadata field create MyObject__c --field-name Company --type Lookup --reference-to Account
 */
export default class MetadataField extends SalesforceBaseCommand {
  static override description = 'Create or update custom fields with auto Field Level Security'

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 3, // create + FLS queries + FLS grant
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
      description: 'Object API name (e.g., Account or MyObject__c)',
      required: true,
    }),
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    'field-name': Flags.string({description: 'Field API name (without __c suffix)', required: true}),
    label: Flags.string({description: 'Field label'}),
    type: Flags.string({description: 'Field type', options: FIELD_TYPES}),
    required: Flags.boolean({description: 'Make field required', default: false}),
    unique: Flags.boolean({description: 'Make field unique', default: false}),
    'external-id': Flags.boolean({description: 'Mark as external ID', default: false}),
    length: Flags.integer({description: 'Field length (for Text fields)'}),
    precision: Flags.integer({description: 'Decimal precision (for Number fields)'}),
    scale: Flags.integer({description: 'Decimal scale (for Number fields)'}),
    'reference-to': Flags.string({description: 'Related object (for Lookup/MasterDetail)'}),
    'relationship-label': Flags.string({description: 'Relationship label'}),
    'relationship-name': Flags.string({description: 'Relationship API name'}),
    'delete-constraint': Flags.string({
      description: 'Delete constraint (Lookup only)',
      options: ['Cascade', 'Restrict', 'SetNull'],
    }),
    'picklist-values': Flags.string({description: 'Comma-separated picklist values'}),
    description: Flags.string({description: 'Field description'}),
    'grant-access-to': Flags.string({
      description: 'Comma-separated profile names for FLS',
      default: 'System Administrator',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {args, flags} = await this.parse(MetadataField)
    const {operation, objectName} = args
    const fieldName = `${flags['field-name']}__c`
    const fullFieldName = `${objectName}.${fieldName}`

    if (this.isDryRun(flags, {operation, objectName, fieldName, type: flags.type})) return

    try {
      const conn = await this.getConnection()

      // Build field metadata
      const metadata: Record<string, unknown> = {
        fullName: fullFieldName,
        label: flags.label || flags['field-name'],
      }

      if (operation === 'create') {
        if (!flags.type) {
          this.error('--type is required for create operation', {exit: 2})
        }

        let fieldType = flags.type
        // Convert TextArea to LongTextArea for Metadata API
        if (fieldType === 'TextArea') {
          fieldType = 'LongTextArea'
          metadata.length = 32_768
          metadata.visibleLines = 3
        }

        metadata.type = fieldType

        if (flags.required) metadata.required = true
        if (flags.unique) metadata.unique = true
        if (flags['external-id']) metadata.externalId = true
        if (flags.length) metadata.length = flags.length
        if (flags.description) metadata.description = flags.description

        // Number fields
        if (flags.precision) metadata.precision = flags.precision
        if (flags.scale) metadata.scale = flags.scale

        // Lookup/MasterDetail fields
        if (flags['reference-to']) {
          metadata.referenceTo = flags['reference-to']
          metadata.relationshipLabel = flags['relationship-label'] || flags['field-name']
          metadata.relationshipName = flags['relationship-name'] || flags['field-name']
          if (fieldType === 'Lookup' && flags['delete-constraint']) {
            metadata.deleteConstraint = flags['delete-constraint']
          }
        }

        // Picklist fields
        if (flags['picklist-values']) {
          const values = flags['picklist-values'].split(',').map((v, i) => ({
            fullName: v.trim(),
            label: v.trim(),
            default: i === 0,
          }))
          metadata.valueSet = {
            valueSetDefinition: {
              sorted: true,
              value: values,
            },
          }
        }

        const result = await conn.metadata.create('CustomField', metadata)
        const res = Array.isArray(result) ? result[0] : result

        if (!res.success) {
          this.outputError({code: 'CREATE_FAILED', message: `Failed to create field: ${JSON.stringify(res)}`})
          return
        }

        // Auto-grant FLS
        const profiles = flags['grant-access-to']?.split(',').map(p => p.trim()) || ['System Administrator']
        const flsResults = await this.grantFieldPermissions(conn, objectName, fieldName, profiles)

        this.outputResult({
          operation: 'create',
          field: fullFieldName,
          type: fieldType,
          fls: flsResults,
        }, this.buildContext({
          relatedCommands: [
            `$BIN salesforce metadata permissions set ${objectName} --field-name ${flags['field-name']} --profiles "Standard User"`,
            `$BIN salesforce data query --query "SELECT ${fieldName} FROM ${objectName} LIMIT 5"`,
          ],
        }))
      } else {
        // Update existing field
        const result = await conn.metadata.update('CustomField', metadata)
        const res = Array.isArray(result) ? result[0] : result

        if (res.success) {
          this.outputResult({operation: 'update', field: fullFieldName, updatedFields: Object.keys(metadata).filter(k => k !== 'fullName')})
        } else {
          this.outputError({code: 'UPDATE_FAILED', message: `Failed to update field: ${JSON.stringify(res)}`})
        }
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }

  /**
   * Grant read/edit FLS to specified profiles.
   */
  private async grantFieldPermissions(
    conn: Connection,
    objectName: string,
    fieldName: string,
    profileNames: string[],
  ): Promise<Array<{profile: string; status: string}>> {
    const results: Array<{profile: string; status: string}> = []
    const fullFieldName = `${objectName}.${fieldName}`

    for (const profileName of profileNames) {
      try {
        // Find profile
        const profileQuery = await conn.query(
          `SELECT Id, Name FROM Profile WHERE Name = '${profileName}'`,
        )
        if (profileQuery.totalSize === 0) {
          results.push({profile: profileName, status: 'Profile not found'})
          continue
        }

        const profileId = (profileQuery.records[0] as {Id: string}).Id

        // Find profile's permission set
        const permSetQuery = await conn.query(
          `SELECT Id FROM PermissionSet WHERE IsOwnedByProfile = true AND ProfileId = '${profileId}'`,
        )
        if (permSetQuery.totalSize === 0) {
          results.push({profile: profileName, status: 'No permission set found'})
          continue
        }

        const permSetId = (permSetQuery.records[0] as {Id: string}).Id

        // Check existing permission
        const existingQuery = await conn.query(
          `SELECT Id FROM FieldPermissions WHERE ParentId = '${permSetId}' AND Field = '${fullFieldName}' AND SobjectType = '${objectName}'`,
        )

        if (existingQuery.totalSize > 0) {
          // Update existing
          await conn.sobject('FieldPermissions').update({
            Id: (existingQuery.records[0] as {Id: string}).Id,
            PermissionsRead: true,
            PermissionsEdit: true,
          })
          results.push({profile: profileName, status: 'Updated'})
        } else {
          // Create new
          await conn.sobject('FieldPermissions').create({
            ParentId: permSetId,
            SobjectType: objectName,
            Field: fullFieldName,
            PermissionsRead: true,
            PermissionsEdit: true,
          })
          results.push({profile: profileName, status: 'Granted'})
        }
      } catch (error) {
        results.push({profile: profileName, status: `Error: ${(error as Error).message}`})
      }
    }

    return results
  }
}
