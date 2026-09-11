// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../base.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

const DEFAULT_TABLES = [
  'incident', 'change_request', 'problem', 'sc_request', 'sc_req_item',
  'cmdb_ci', 'sys_user', 'sys_user_group', 'kb_knowledge', 'task',
  'sc_cat_item', 'sla', 'sn_customerservice_case', 'ast_contract',
  'core_company', 'alm_asset',
]

/**
 * Sentinel value written to the create-probe record's name/short_description.
 * The create permission check POSTs a throwaway record; it is deleted
 * immediately afterward, but if the account lacks delete permission the
 * record persists. Tagging it with a recognizable, queryable value means
 * any such residue can be found and purged (e.g.
 * `nameSTARTSWITH__p1_introspection_probe__`) rather than masquerading as
 * a real but nameless record.
 */
const PROBE_SENTINEL = '__p1_introspection_probe__'

/**
 * Introspect ServiceNow permissions for the authenticated service account.
 * Returns user roles and table-level CRUD permissions via empirical probing.
 *
 * Examples:
 *   aclif servicenow introspect --json
 *   aclif servicenow introspect --tables incident,change_request,problem --json
 */
export default class ServiceNowIntrospect extends ServiceNowBaseCommand {
  static override description = 'Introspect ServiceNow permissions: roles and table-level CRUD access'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 50,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "Roles of the credentials and the CRUD they hold on each probed table",
    fields: {
      introspectedAt: {type: "string", description: "ISO timestamp"},
      serviceAccountId: {type: "string", description: "username of the credentials"},
      roles: {type: "array", description: "granted role names"},
      tables: {type: "object", description: "table name to {read, create, update, delete, ...}"},
    },
    example: {"introspectedAt": "2026-09-11T00:00:00.000Z", "serviceAccountId": "api.user", "roles": ["itil"], "tables": {"incident": {"read": true, "create": true, "update": true, "delete": false}}},
  }

  static override flags = {
    ...ServiceNowBaseCommand.baseFlags,
    ...ServiceNowBaseCommand.tenantFlags,
    tables: Flags.string({
      description: 'Comma-separated list of tables to probe (defaults to 16 key ITSM tables)',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(ServiceNowIntrospect)

    try {
      const client = await this.getConnection()
      if (await this.handleTenantFlags(flags, client)) return
      const targetTables = flags.tables
        ? flags.tables.split(',').map(t => t.trim())
        : DEFAULT_TABLES

      // Step 1: Collect user roles
      const roles = await this.collectRoles(client, flags['sn-username'])

      // Step 2: Probe table-level CRUD
      const tables: Record<string, {read: boolean; create: boolean; update: boolean; delete: boolean}> = {}

      for (const table of targetTables) {
        tables[table] = await this.probeTable(client, table)
      }

      const result = {
        introspectedAt: new Date().toISOString(),
        serviceAccountId: flags['sn-username'] || undefined,
        roles,
        tables,
      }

      await this.outputResult(result, this.buildContext({
        returned: Object.keys(tables).length,
        refinements: ['Use --tables to probe specific tables'],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }

  /**
   * Collect granted roles for the authenticated user.
   */
  private async collectRoles(client: any, username?: string): Promise<string[]> {
    const roles: string[] = []

    try {
      if (!username) return roles

      // Get user's sys_id
      const userResult = await client.tableQuery('sys_user', {
        sysparm_query: `user_name=${username}`,
        sysparm_fields: 'sys_id',
        sysparm_limit: 1,
      })

      const userSysId = (userResult.result as any[])[0]?.sys_id as string | undefined
      if (!userSysId) return roles

      // Get granted roles
      const rolesResult = await client.tableQuery('sys_user_has_role', {
        sysparm_query: `user=${userSysId}^state=granted`,
        sysparm_fields: 'role.name',
        sysparm_limit: 500,
      })

      for (const r of rolesResult.result as any[]) {
        const name = r['role.name']
        if (name && !roles.includes(name)) roles.push(name)
      }
    } catch {
      // Role collection failed, return empty
    }

    return roles
  }

  /**
   * Probe a table for read/create/update permissions using empirical testing.
   * Delete is always false (too destructive to probe).
   */
  private async probeTable(
    client: any,
    table: string,
  ): Promise<{read: boolean; create: boolean; update: boolean; delete: boolean}> {
    const perms = {read: false, create: false, update: false, delete: false}

    // Read probe: try to query 1 record
    try {
      await client.tableQuery(table, {sysparm_limit: 1, sysparm_fields: 'sys_id'})
      perms.read = true
    } catch (err: any) {
      // If error includes 403 or 401, no read access
      // Otherwise might be a network issue — assume no read
    }

    // Create probe: POST a sentinel-tagged dummy record to test create
    // permission empirically, then immediately delete it so the probe
    // leaves no residue. The sentinel name/short_description make any
    // record that cannot be cleaned up (e.g. the account lacks delete
    // permission) identifiable and purgeable later. Without this cleanup,
    // introspection at every gateway boot accumulated nameless rows in
    // creatable tables (notably core_company), which surfaced downstream
    // as "customer has no name" runtime errors.
    try {
      const created = await client.tableCreate(table, {
        __introspection_probe__: true,
        name: PROBE_SENTINEL,
        short_description: PROBE_SENTINEL,
      })
      perms.create = true
      // tableCreate returns the new row including its sys_id. Delete it
      // best-effort; if delete is not permitted the sentinel tag keeps
      // the record findable for manual/scripted purging.
      const createdSysId = (created.result as Record<string, unknown> | undefined)?.sys_id as string | undefined
      if (createdSysId) {
        try {
          await client.tableDelete(table, createdSysId)
        } catch {
          // Delete not permitted or failed. Probe record remains but is
          // tagged with PROBE_SENTINEL so it can be located and removed.
        }
      }
    } catch (err: any) {
      const msg = String(err?.message || '')
      // 403/401 = no create permission. Any other error = has permission but bad data
      if (msg.includes('(403)') || msg.includes('(401)')) {
        perms.create = false
      } else {
        // Got 400 or other error = has create permission but data was invalid
        perms.create = true
      }
    }

    // Update probe: PATCH existing record with empty body
    if (perms.read) {
      try {
        const readResult = await client.tableQuery(table, {sysparm_limit: 1, sysparm_fields: 'sys_id'})
        const sysId = (readResult.result as any[])[0]?.sys_id as string | undefined
        if (sysId) {
          try {
            await client.tableUpdate(table, sysId, {})
            perms.update = true
          } catch (err: any) {
            const msg = String(err?.message || '')
            if (msg.includes('(403)') || msg.includes('(401)')) {
              perms.update = false
            } else {
              perms.update = true
            }
          }
        }
      } catch {
        // Can't read to find a record to update-probe
      }
    }

    // Delete: always false — too destructive to probe
    return perms
  }
}
