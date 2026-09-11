// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataDescribe extends SalesforceBaseCommand {
  static override description = 'Describe a Salesforce object schema (fields, relationships, metadata)'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Describe Account object',
      command: '$BIN salesforce data describe Account',
      responseShape: {name: 'Account', fieldCount: 72, fields: [{name: 'Id', type: 'id'}, {name: 'Name', type: 'string'}]},
    },
    {
      description: 'Describe a custom object',
      command: '$BIN salesforce data describe Merchandise__c',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Object schema with fields, relationships, and CRUD capabilities',
    fields: {
      name: {type: 'string', description: 'API name of the object'},
      label: {type: 'string', description: 'Display label'},
      custom: {type: 'boolean', description: 'Whether this is a custom object'},
      queryable: {type: 'boolean', description: 'Whether the object supports SOQL queries'},
      fieldCount: {type: 'integer', description: 'Total number of fields'},
      fields: {type: 'array', description: 'Array of field metadata (name, label, type, picklist values)'},
      childRelationships: {type: 'array', description: 'Related child objects'},
    },
    example: {name: 'Account', label: 'Account', custom: false, queryable: true, fieldCount: 72, fields: [{name: 'Id', type: 'id'}]},
  }

  static override flagCategories: FlagCategorization = {
    fields: ['output'],
    json: ['output'],
    'instance-url': ['auth'],
    'access-token': ['auth'],
    'service-account': ['auth'],
  }

  static override args = {
    objectName: Args.string({
      description: 'Salesforce object API name (e.g., Account, Opportunity, Custom__c)',
      required: true,
    }),
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    ...SalesforceBaseCommand.canonicalFlags,
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args, flags} = await this.parse(DataDescribe)
    const canon = flags.canonical ? await this.resolveCanonical(flags, args.objectName) : undefined
    const objectName = canon ? canon.entity : args.objectName

    if (this.isDryRun(flags, {objectName})) return

    try {
      const conn = await this.getConnection()
      const desc = await conn.describe(objectName)

      await this.outputResult({
        ...(canon ? {canonical: {...canon.context, fields: canon.toNative}} : {}),
        name: desc.name,
        label: desc.label,
        labelPlural: desc.labelPlural,
        custom: desc.custom,
        keyPrefix: desc.keyPrefix,
        queryable: desc.queryable,
        createable: desc.createable,
        updateable: desc.updateable,
        deletable: desc.deletable,
        fieldCount: desc.fields.length,
        fields: desc.fields.map((f: Record<string, unknown>) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          length: f.length,
          custom: f.custom,
          nillable: f.nillable,
          createable: f.createable,
          updateable: f.updateable,
          referenceTo: f.referenceTo,
          // SOQL relationship dot-walks key off this name, not the field
          // name itself: AccountId carries relationshipName='Account', so
          // a downstream tool can query SELECT Account.Name FROM Case.
          // Custom lookups follow the __c → __r convention. Including this
          // here mirrors what we already do for childRelationships below.
          relationshipName: f.relationshipName,
          picklistValues: (f.picklistValues as Array<{value: string; active: boolean}> || [])
            .filter((pv: {active: boolean}) => pv.active)
            .map((pv: {value: string}) => pv.value),
        })),
        childRelationships: desc.childRelationships
          .filter((cr: Record<string, unknown>) => cr.relationshipName)
          .map((cr: Record<string, unknown>) => ({
            childSObject: cr.childSObject,
            field: cr.field,
            relationshipName: cr.relationshipName,
          })),
      }, this.buildContext({
        returned: desc.fields.length,
        relatedCommands: [
          `$BIN salesforce data query --query "SELECT Id, Name FROM ${objectName} LIMIT 10"`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
