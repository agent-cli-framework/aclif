// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'
import type {DescribeSObjectResult} from 'jsforce'

import {SalesforceBaseCommand} from '../base.js'
import {apiNameToCommandName, COMMON_STANDARD_OBJECTS, discoverSchema, fieldsToFlags} from '../discovery.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

type SfField = DescribeSObjectResult['fields'][0]
type SfPicklistValue = {value: string; label: string; active: boolean; defaultValue: boolean}

/**
 * Discover custom objects and fields in the target Salesforce org.
 * Used for deploy-time dynamic command generation.
 *
 * Examples:
 *   aclif salesforce discover
 *   aclif salesforce discover --verbose
 *   aclif salesforce discover --object Merchandise__c
 */
export default class SalesforceDiscover extends SalesforceBaseCommand {
  static override description = 'Discover custom objects and fields in the target Salesforce org for dynamic command generation'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 20, // Multiple describe calls
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "Custom objects and standard objects with custom fields in the org, or one object in full with --object",
    fields: {
      discoveredAt: {type: "string", description: "ISO timestamp"},
      orgId: {type: "string", description: "org id"},
      apiVersion: {type: "string", description: "API version used"},
      customObjectCount: {type: "number", description: "custom objects found"},
      standardObjectsWithCustomFields: {type: "number", description: "standard objects carrying custom fields"},
      customObjects: {type: "array", description: "array of {apiName, label, commandName, fieldCount, queryable, createable}"},
      standardObjectCustomFields: {type: "object", description: "standard object to its custom field names"},
    },
    example: {"discoveredAt": "2026-09-11T00:00:00.000Z", "orgId": "00Dxx0000000000", "apiVersion": "59.0", "customObjectCount": 1, "standardObjectsWithCustomFields": 1, "customObjects": [{"apiName": "Warranty__c", "label": "Warranty", "commandName": "warranty", "fieldCount": 12, "queryable": true, "createable": true}], "standardObjectCustomFields": {"Account": ["Tier__c"]}},
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    verbose: Flags.boolean({description: 'Include full field metadata', default: false}),
    object: Flags.string({description: 'Discover a specific object only', char: 'o'}),
    'generate-commands': Flags.boolean({
      description: 'Output generated command definitions for custom objects',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(SalesforceDiscover)

    try {
      const conn = await this.getConnection()

      if (flags.object) {
        // Describe a single object
        const desc = await conn.describe(flags.object)

        const result: Record<string, unknown> = {
          apiName: desc.name,
          label: desc.label,
          custom: desc.custom,
          queryable: desc.queryable,
          createable: desc.createable,
          updateable: desc.updateable,
          deletable: desc.deletable,
          fieldCount: desc.fields.length,
          customFieldCount: desc.fields.filter(f => f.custom).length,
        }

        if (flags.verbose) {
          result.fields = desc.fields.map((f: SfField) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            custom: f.custom,
            createable: f.createable,
            updateable: f.updateable,
            nillable: f.nillable,
            picklistValues: f.picklistValues?.filter((pv: SfPicklistValue) => pv.active).map((pv: SfPicklistValue) => pv.value),
            referenceTo: f.referenceTo,
          }))
        }

        if (flags['generate-commands']) {
          const commandName = apiNameToCommandName(desc.name)
          const generatedFlags = fieldsToFlags(
            desc.fields.filter((f: SfField) => f.custom).map((f: SfField) => ({
              name: f.name,
              label: f.label,
              type: f.type,
              length: f.length || 0,
              nillable: f.nillable,
              createable: f.createable,
              updateable: f.updateable,
              defaultValue: f.defaultValue,
              picklistValues: (f.picklistValues || []).map((pv: SfPicklistValue) => ({
                value: pv.value, label: pv.label, active: pv.active, defaultValue: pv.defaultValue,
              })),
              referenceTo: f.referenceTo || [],
              relationshipName: f.relationshipName || null,
              externalId: f.externalId || false,
              unique: f.unique || false,
              calculated: f.calculated || false,
            })),
          )

          result.generatedCommands = {
            topic: `salesforce ${commandName}`,
            commands: ['list', 'get', 'create', 'update', 'delete'],
            flags: generatedFlags,
            examples: [
              `$BIN salesforce ${commandName} list --json`,
              `$BIN salesforce ${commandName} get <recordId> --json`,
            ],
          }
        }

        await this.outputResult(result)
        return
      }

      // Full org discovery
      const discovery = await discoverSchema(conn, {standardObjects: COMMON_STANDARD_OBJECTS})

      const summary: Record<string, unknown> = {
        discoveredAt: discovery.discoveredAt,
        orgId: discovery.orgId,
        apiVersion: discovery.apiVersion,
        customObjectCount: discovery.customObjects.length,
        standardObjectsWithCustomFields: discovery.standardObjectCustomFields.size,
        customObjects: discovery.customObjects.map(obj => ({
          apiName: obj.apiName,
          label: obj.label,
          commandName: apiNameToCommandName(obj.apiName),
          fieldCount: obj.fields.length,
          queryable: obj.queryable,
          createable: obj.createable,
          ...(flags.verbose ? {fields: obj.fields.map(f => ({name: f.name, type: f.type, label: f.label}))} : {}),
        })),
      }

      if (flags.verbose) {
        const customFieldMap: Record<string, Array<{name: string; type: string; label: string}>> = {}
        for (const [objName, fields] of discovery.standardObjectCustomFields) {
          customFieldMap[objName] = fields.map(f => ({name: f.name, type: f.type, label: f.label}))
        }

        summary.standardObjectCustomFields = customFieldMap
      }

      await this.outputResult(summary, this.buildContext({
        returned: discovery.customObjects.length,
        refinements: ['Use --object <name> to see full details for a specific object'],
        relatedCommands: discovery.customObjects.slice(0, 3).map(obj =>
          `$BIN salesforce discover --object ${obj.apiName} --generate-commands`,
        ),
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
