// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../base.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

/**
 * Introspect Salesforce permissions for the authenticated service account.
 * Returns object-level CRUD, field-level security, and system permissions.
 *
 * Examples:
 *   aclif salesforce introspect --json
 *   aclif salesforce introspect --field-detail --json
 *   aclif salesforce introspect --field-detail --field-detail-limit 20 --json
 */
export default class SalesforceIntrospect extends SalesforceBaseCommand {
  static override description = 'Introspect Salesforce permissions: object CRUD, field-level security, and system permissions'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 65,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "Effective permissions of the credentials: system permissions, object CRUD, and optionally permission sets and groups",
    fields: {
      introspectedAt: {type: "string", description: "ISO timestamp"},
      serviceAccountId: {type: "string", description: "user id of the credentials"},
      systemPermissions: {type: "object", description: "{modifyAllData, viewAllData, apiEnabled, ...}"},
      objects: {type: "object", description: "object name to {read, create, update, delete, fields}"},
      permissionSets: {type: "array", description: "present with --permission-sets: [{id, name, label, ...}]"},
      permissionSetGroups: {type: "array", description: "present with --permission-set-groups: [{id, developerName, label, status, memberPermissionSetIds}]"},
    },
    example: {"introspectedAt": "2026-09-11T00:00:00.000Z", "serviceAccountId": "005xx0000000000", "systemPermissions": {"modifyAllData": false, "apiEnabled": true}, "objects": {"Account": {"read": true, "create": true, "update": true, "delete": false}}},
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    ...SalesforceBaseCommand.tenantFlags,
    'field-detail': Flags.boolean({
      description: 'Fetch field-level security for key objects via Composite API',
      default: false,
    }),
    'field-detail-limit': Flags.integer({
      description: 'Maximum number of objects to fetch field-level detail for',
      default: 50,
    }),
    'permission-sets': Flags.boolean({
      description: 'Fetch Permission Set grouping for object permissions',
      default: false,
    }),
    'permission-set-groups': Flags.boolean({
      description: 'Fetch Permission Set Groups and their member Permission Sets (implies --permission-sets)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(SalesforceIntrospect)

    try {
      const conn = await this.getConnection()
      if (await this.handleTenantFlags(flags, conn)) return

      // Step 1: Describe Global — all queryable objects with CRUD
      const globalDescribe = await conn.describeGlobal()

      const objects: Record<string, {
        read: boolean
        create: boolean
        update: boolean
        delete: boolean
        viewAll?: boolean
        modifyAll?: boolean
        fields?: Record<string, {read: boolean; write: boolean}>
      }> = {}

      const queryableObjects = globalDescribe.sobjects.filter(o => o.queryable)

      for (const obj of queryableObjects) {
        objects[obj.name] = {
          read: obj.queryable,
          create: obj.createable,
          update: obj.updateable,
          delete: obj.deletable,
        }
      }

      // Step 2: Batch field-level security via Composite API
      if (flags['field-detail']) {
        const limit = flags['field-detail-limit']
        const keyObjects = queryableObjects.slice(0, limit)

        // Batch 25 at a time
        for (let i = 0; i < keyObjects.length; i += 25) {
          const batch = keyObjects.slice(i, i + 25)

          try {
            const descriptions = await Promise.all(
              batch.map(obj => conn.describe(obj.name).catch(() => null)),
            )

            for (const desc of descriptions) {
              if (!desc) continue
              if (!objects[desc.name]) continue

              objects[desc.name].fields = {}
              for (const field of desc.fields) {
                objects[desc.name].fields![field.name] = {
                  read: true, // If it's in the describe response, user can read it
                  write: field.createable || field.updateable,
                }
              }
            }
          } catch {
            // Batch failed, continue with next
          }
        }
      }

      // Step 3: Identity + System permissions (ViewAllData, ModifyAllData, ApiEnabled)
      const systemPermissions = {viewAllData: false, modifyAllData: false, apiEnabled: true}
      let userId: string | undefined
      let serviceAccountId: string | undefined

      try {
        const identity = await conn.identity()
        userId = identity.user_id
        serviceAccountId = identity.username

        const permResult = await conn.query<{
          PermissionsViewAllData: boolean
          PermissionsModifyAllData: boolean
          PermissionsApiEnabled: boolean
        }>(
          `SELECT PermissionsViewAllData, PermissionsModifyAllData, PermissionsApiEnabled ` +
          `FROM PermissionSet WHERE Id IN (` +
          `SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${userId}')`,
        )

        for (const r of permResult.records) {
          if (r.PermissionsViewAllData) systemPermissions.viewAllData = true
          if (r.PermissionsModifyAllData) systemPermissions.modifyAllData = true
          if (r.PermissionsApiEnabled) systemPermissions.apiEnabled = true
        }
      } catch {
        // System permissions query failed, use defaults
      }

      // Step 4: Permission Set grouping (optional)
      // --permission-set-groups implies --permission-sets
      const fetchPermSets = flags['permission-sets'] || flags['permission-set-groups']

      let permissionSets: Array<{
        id: string
        name: string
        label: string
        description?: string
        isOwnedByProfile: boolean
        profileName?: string
        objectPermissions: Record<string, {
          read: boolean; create: boolean; update: boolean; delete: boolean
          viewAll: boolean; modifyAll: boolean
        }>
      }> | undefined

      if (fetchPermSets && userId) {
        try {
          // Query 1: Fetch assigned Permission Sets
          const psResult = await conn.query<{
            Id: string
            Name: string
            Label: string
            Description: string | null
            IsOwnedByProfile: boolean
            Profile?: {Name: string}
          }>(
            `SELECT Id, Name, Label, Description, IsOwnedByProfile, Profile.Name ` +
            `FROM PermissionSet WHERE Id IN (` +
            `SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${userId}')`,
          )

          // Build lookup map
          const psMap = new Map<string, typeof permissionSets extends Array<infer T> | undefined ? T : never>()
          for (const ps of psResult.records) {
            psMap.set(ps.Id, {
              id: ps.Id,
              name: ps.Name,
              label: ps.Label,
              description: ps.Description ?? undefined,
              isOwnedByProfile: ps.IsOwnedByProfile,
              profileName: ps.Profile?.Name,
              objectPermissions: {},
            })
          }

          // Query 2: Fetch ObjectPermissions grouped by parent Permission Set
          const opResult = await conn.query<{
            ParentId: string
            SobjectType: string
            PermissionsCreate: boolean
            PermissionsRead: boolean
            PermissionsEdit: boolean
            PermissionsDelete: boolean
            PermissionsViewAllRecords: boolean
            PermissionsModifyAllRecords: boolean
          }>(
            `SELECT ParentId, SobjectType, ` +
            `PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, ` +
            `PermissionsViewAllRecords, PermissionsModifyAllRecords ` +
            `FROM ObjectPermissions WHERE ParentId IN (` +
            `SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${userId}')`,
          )

          // Handle pagination — fetch all records if more exist
          let allRecords = opResult.records
          let nextResult = opResult
          while (!nextResult.done && nextResult.nextRecordsUrl) {
            nextResult = await conn.queryMore<typeof opResult.records[0]>(nextResult.nextRecordsUrl)
            allRecords = allRecords.concat(nextResult.records)
          }

          // Group object permissions by parent Permission Set
          for (const op of allRecords) {
            const ps = psMap.get(op.ParentId)
            if (!ps) continue

            ps.objectPermissions[op.SobjectType] = {
              read: op.PermissionsRead,
              create: op.PermissionsCreate,
              update: op.PermissionsEdit,
              delete: op.PermissionsDelete,
              viewAll: op.PermissionsViewAllRecords,
              modifyAll: op.PermissionsModifyAllRecords,
            }

            // Backfill viewAll/modifyAll on the flat objects map
            if (objects[op.SobjectType]) {
              if (op.PermissionsViewAllRecords) objects[op.SobjectType].viewAll = true
              if (op.PermissionsModifyAllRecords) objects[op.SobjectType].modifyAll = true
            }
          }

          permissionSets = Array.from(psMap.values())
        } catch {
          // Permission set queries failed, continue without them
        }
      }

      // Step 5: Permission Set Groups (optional)
      let permissionSetGroups: Array<{
        id: string
        developerName: string
        label: string
        description?: string
        status: string
        memberPermissionSetIds: string[]
      }> | undefined

      if (flags['permission-set-groups'] && permissionSets) {
        try {
          // Query 1: Fetch all PermissionSetGroups in the org
          const psgResult = await conn.query<{
            Id: string
            DeveloperName: string
            MasterLabel: string
            Description: string | null
            Status: string
          }>(
            `SELECT Id, DeveloperName, MasterLabel, Description, Status ` +
            `FROM PermissionSetGroup`,
          )

          if (psgResult.records.length > 0) {
            const groupIds = psgResult.records.map(g => `'${g.Id}'`).join(',')

            // Query 2: Fetch group-to-permset membership
            const componentResult = await conn.query<{
              PermissionSetGroupId: string
              PermissionSetId: string
            }>(
              `SELECT PermissionSetGroupId, PermissionSetId ` +
              `FROM PermissionSetGroupComponent ` +
              `WHERE PermissionSetGroupId IN (${groupIds})`,
            )

            // Handle pagination
            let allComponents = componentResult.records
            let nextComp = componentResult
            while (!nextComp.done && nextComp.nextRecordsUrl) {
              nextComp = await conn.queryMore<typeof componentResult.records[0]>(nextComp.nextRecordsUrl)
              allComponents = allComponents.concat(nextComp.records)
            }

            // Collect all member permset IDs that aren't already in our psMap
            const existingPsIds = new Set(permissionSets.map(ps => ps.id))
            const missingPsIds = [...new Set(allComponents.map(c => c.PermissionSetId))]
              .filter(id => !existingPsIds.has(id))

            // Query 3: Fetch details for member permsets not already introspected
            if (missingPsIds.length > 0) {
              const missingIdsStr = missingPsIds.map(id => `'${id}'`).join(',')
              const missingResult = await conn.query<{
                Id: string
                Name: string
                Label: string
                Description: string | null
                IsOwnedByProfile: boolean
                Profile?: {Name: string}
              }>(
                `SELECT Id, Name, Label, Description, IsOwnedByProfile, Profile.Name ` +
                `FROM PermissionSet WHERE Id IN (${missingIdsStr})`,
              )

              // Fetch ObjectPermissions for the missing permsets
              const missingOpResult = await conn.query<{
                ParentId: string
                SobjectType: string
                PermissionsCreate: boolean
                PermissionsRead: boolean
                PermissionsEdit: boolean
                PermissionsDelete: boolean
                PermissionsViewAllRecords: boolean
                PermissionsModifyAllRecords: boolean
              }>(
                `SELECT ParentId, SobjectType, ` +
                `PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, ` +
                `PermissionsViewAllRecords, PermissionsModifyAllRecords ` +
                `FROM ObjectPermissions WHERE ParentId IN (${missingIdsStr})`,
              )

              let allMissingOps = missingOpResult.records
              let nextMissingOp = missingOpResult
              while (!nextMissingOp.done && nextMissingOp.nextRecordsUrl) {
                nextMissingOp = await conn.queryMore<typeof missingOpResult.records[0]>(nextMissingOp.nextRecordsUrl)
                allMissingOps = allMissingOps.concat(nextMissingOp.records)
              }

              // Build missing permset entries and add to permissionSets array
              const missingPsMap = new Map<string, typeof permissionSets[0]>()
              for (const ps of missingResult.records) {
                missingPsMap.set(ps.Id, {
                  id: ps.Id,
                  name: ps.Name,
                  label: ps.Label,
                  description: ps.Description ?? undefined,
                  isOwnedByProfile: ps.IsOwnedByProfile,
                  profileName: ps.Profile?.Name,
                  objectPermissions: {},
                })
              }

              for (const op of allMissingOps) {
                const ps = missingPsMap.get(op.ParentId)
                if (!ps) continue
                ps.objectPermissions[op.SobjectType] = {
                  read: op.PermissionsRead,
                  create: op.PermissionsCreate,
                  update: op.PermissionsEdit,
                  delete: op.PermissionsDelete,
                  viewAll: op.PermissionsViewAllRecords,
                  modifyAll: op.PermissionsModifyAllRecords,
                }
              }

              permissionSets.push(...missingPsMap.values())
            }

            // Build group membership map
            const groupMemberMap = new Map<string, string[]>()
            for (const comp of allComponents) {
              const members = groupMemberMap.get(comp.PermissionSetGroupId) || []
              members.push(comp.PermissionSetId)
              groupMemberMap.set(comp.PermissionSetGroupId, members)
            }

            permissionSetGroups = psgResult.records.map(g => ({
              id: g.Id,
              developerName: g.DeveloperName,
              label: g.MasterLabel,
              description: g.Description ?? undefined,
              status: g.Status,
              memberPermissionSetIds: groupMemberMap.get(g.Id) || [],
            }))
          }
        } catch {
          // Permission Set Group queries failed, continue without them
        }
      }

      const result: Record<string, unknown> = {
        introspectedAt: new Date().toISOString(),
        serviceAccountId,
        systemPermissions,
        objects,
      }

      if (permissionSets) {
        result.permissionSets = permissionSets
      }

      if (permissionSetGroups) {
        result.permissionSetGroups = permissionSetGroups
      }

      await this.outputResult(result, this.buildContext({
        returned: Object.keys(objects).length,
        refinements: [
          'Use --field-detail to include field-level security',
          'Use --permission-sets to group objects by Salesforce Permission Set',
          'Use --permission-set-groups to include Permission Set Groups and their members',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
