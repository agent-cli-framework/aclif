// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../base.js'
import {describeServiceNowTable, discoverServiceNowSchema, getFieldChoices} from '../discovery.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

/**
 * Discover tables and fields in the target ServiceNow instance.
 *
 * Examples:
 *   aclif servicenow discover
 *   aclif servicenow discover --verbose
 *   aclif servicenow discover --table incident --verbose
 *   aclif servicenow discover --include-custom
 */
export default class ServiceNowDiscover extends ServiceNowBaseCommand {
  static override description = 'Discover tables and fields in the target ServiceNow instance'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 20,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "Tables and fields in the instance, or one table in full with --table",
    fields: {
      discoveredAt: {type: "string", description: "ISO timestamp"},
      instanceUrl: {type: "string", description: "instance URL"},
      tableCount: {type: "number", description: "tables described"},
      tables: {type: "array", description: "array of {apiName, label, custom, fieldCount} plus fields with --verbose"},
    },
    example: {"discoveredAt": "2026-09-11T00:00:00.000Z", "instanceUrl": "https://example.service-now.com", "tableCount": 2, "tables": [{"apiName": "incident", "label": "Incident", "custom": false, "fieldCount": 80}]},
  }

  static override flags = {
    ...ServiceNowBaseCommand.baseFlags,
    verbose: Flags.boolean({description: 'Include full field metadata', default: false}),
    table: Flags.string({description: 'Discover a specific table only'}),
    'include-custom': Flags.boolean({
      description: 'Include custom tables (u_* and x_* prefixed)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(ServiceNowDiscover)

    try {
      const client = await this.getConnection()

      if (flags.table) {
        // Describe a single table
        const desc = await describeServiceNowTable(client, flags.table)

        const result: Record<string, unknown> = {
          apiName: desc.apiName,
          label: desc.label,
          custom: desc.custom,
          fieldCount: desc.fields.length,
        }

        if (flags.verbose) {
          // Enrich choice fields with picklist values
          const choiceFields = desc.fields.filter(f => f.type === 'picklist')
          for (const field of choiceFields.slice(0, 10)) { // Limit to avoid rate limits
            const choices = await getFieldChoices(client, flags.table, field.name)
            field.picklistValues = choices
          }

          result.fields = desc.fields.map(f => ({
            name: f.name,
            label: f.label,
            type: f.type,
            nillable: f.nillable,
            createable: f.createable,
            updateable: f.updateable,
            referenceTo: f.referenceTo.length > 0 ? f.referenceTo : undefined,
            picklistValues: f.picklistValues.length > 0
              ? f.picklistValues.filter(pv => pv.active).map(pv => pv.value)
              : undefined,
          }))
        }

        await this.outputResult(result, this.buildContext({
          returned: desc.fields.length,
          relatedCommands: [
            `$BIN servicenow data query --table ${flags.table} --limit 5 --json`,
            `$BIN servicenow data describe ${flags.table} --json`,
          ],
        }))
        return
      }

      // Full instance discovery
      const discovery = await discoverServiceNowSchema(client, {
        includeCustom: flags['include-custom'],
      })

      const summary: Record<string, unknown> = {
        discoveredAt: discovery.discoveredAt,
        instanceUrl: discovery.instanceUrl,
        tableCount: discovery.tables.length,
        tables: discovery.tables.map(t => ({
          apiName: t.apiName,
          label: t.label,
          custom: t.custom,
          fieldCount: t.fields.length,
          ...(flags.verbose ? {
            fields: t.fields.map(f => ({name: f.name, type: f.type, label: f.label})),
          } : {}),
        })),
      }

      await this.outputResult(summary, this.buildContext({
        returned: discovery.tables.length,
        refinements: ['Use --table <name> to see full details for a specific table'],
        relatedCommands: discovery.tables.slice(0, 3).map(t =>
          `$BIN servicenow discover --table ${t.apiName} --verbose`,
        ),
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
