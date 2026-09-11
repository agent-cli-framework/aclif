// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata} from '../../../../../core/contract/aci.js'

/**
 * Manage Field Level Security (FLS) for custom fields.
 *
 * Examples:
 *   aclif salesforce metadata permissions set Account --field-name Revenue_Tier --profiles "Standard User,Marketing"
 *   aclif salesforce metadata permissions view Account --field-name Revenue_Tier
 *   aclif salesforce metadata permissions revoke Account --field-name Revenue_Tier --profiles "Standard User"
 */
export default class MetadataPermissions extends SalesforceBaseCommand {
  static override description = 'Manage Field Level Security for custom fields'

  static override aciMetadata: AciMetadata = {
    mutability: 'update',
    idempotent: true,
    reversible: true,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 3,
    requiresConfirmation: false,
    prerequisites: [],
    capabilities: ['metadata_change'],
  }

  static override args = {
    operation: Args.string({
      description: 'Operation: grant, revoke, or view permissions',
      required: true,
      options: ['grant', 'revoke', 'view'],
    }),
    objectName: Args.string({
      description: 'Object API name',
      required: true,
    }),
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    'field-name': Flags.string({description: 'Field API name (without __c suffix)', required: true}),
    profiles: Flags.string({description: 'Comma-separated profile names', default: 'System Administrator'}),
    readable: Flags.boolean({description: 'Grant read access', default: true}),
    editable: Flags.boolean({description: 'Grant edit access (requires readable)', default: true}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args, flags} = await this.parse(MetadataPermissions)
    const {operation, objectName} = args
    const fieldName = `${flags['field-name']}__c`
    const fullFieldName = `${objectName}.${fieldName}`

    if (this.isDryRun(flags, {operation, objectName, fieldName, profiles: flags.profiles})) return

    try {
      const conn = await this.getConnection()

      if (operation === 'view') {
        const result = await conn.query(
          `SELECT Id, Parent.Profile.Name, Parent.IsOwnedByProfile, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${objectName}' AND Field = '${fullFieldName}' ORDER BY Parent.Profile.Name`,
        )

        const permissions = result.records.map((r: Record<string, unknown>) => ({
          profile: (r as {Parent?: {Profile?: {Name?: string}}}).Parent?.Profile?.Name || 'Unknown',
          readable: (r as {PermissionsRead?: boolean}).PermissionsRead,
          editable: (r as {PermissionsEdit?: boolean}).PermissionsEdit,
        }))

        this.outputResult({field: fullFieldName, permissions}, this.buildContext({
          returned: permissions.length,
          relatedCommands: [
            `$BIN salesforce metadata permissions grant ${objectName} --field-name ${flags['field-name']} --profiles "Standard User"`,
          ],
        }))
        return
      }

      const profileNames = flags.profiles?.split(',').map(p => p.trim()) || []
      const results: Array<{profile: string; action: string; status: string}> = []

      for (const profileName of profileNames) {
        try {
          const profileQuery = await conn.query(
            `SELECT Id FROM Profile WHERE Name = '${profileName}'`,
          )
          if (profileQuery.totalSize === 0) {
            results.push({profile: profileName, action: operation, status: 'Profile not found'})
            continue
          }

          const profileId = (profileQuery.records[0] as {Id: string}).Id

          const permSetQuery = await conn.query(
            `SELECT Id FROM PermissionSet WHERE IsOwnedByProfile = true AND ProfileId = '${profileId}'`,
          )
          if (permSetQuery.totalSize === 0) {
            results.push({profile: profileName, action: operation, status: 'No permission set found'})
            continue
          }

          const permSetId = (permSetQuery.records[0] as {Id: string}).Id

          const existingQuery = await conn.query(
            `SELECT Id FROM FieldPermissions WHERE ParentId = '${permSetId}' AND Field = '${fullFieldName}' AND SobjectType = '${objectName}'`,
          )

          if (operation === 'grant') {
            if (existingQuery.totalSize > 0) {
              await conn.sobject('FieldPermissions').update({
                Id: (existingQuery.records[0] as {Id: string}).Id,
                PermissionsRead: flags.readable,
                PermissionsEdit: flags.editable,
              })
              results.push({profile: profileName, action: 'grant', status: 'Updated'})
            } else {
              await conn.sobject('FieldPermissions').create({
                ParentId: permSetId,
                SobjectType: objectName,
                Field: fullFieldName,
                PermissionsRead: flags.readable,
                PermissionsEdit: flags.editable,
              })
              results.push({profile: profileName, action: 'grant', status: 'Created'})
            }
          } else if (operation === 'revoke') {
            if (existingQuery.totalSize > 0) {
              await conn.sobject('FieldPermissions').delete(
                (existingQuery.records[0] as {Id: string}).Id,
              )
              results.push({profile: profileName, action: 'revoke', status: 'Revoked'})
            } else {
              results.push({profile: profileName, action: 'revoke', status: 'No existing permission'})
            }
          }
        } catch (error) {
          results.push({profile: profileName, action: operation, status: `Error: ${(error as Error).message}`})
        }
      }

      this.outputResult({field: fullFieldName, operation, results})
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
