// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../../base.js'
import {describeServiceNowTable, getFieldChoices} from '../../discovery.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataDescribe extends ServiceNowBaseCommand {
  static override description = 'Describe a ServiceNow table and its fields'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Describe incident table',
      command: '$BIN servicenow data describe incident',
      responseShape: {table: 'incident', fieldCount: 85, fields: [{name: 'number', type: 'string'}, {name: 'priority', type: 'picklist'}]},
    },
    {
      description: 'Describe with choice values',
      command: '$BIN servicenow data describe sys_user --include-choices',
    },
    {
      description: 'Filter to reference fields only',
      command: '$BIN servicenow data describe change_request --field-filter reference',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Table schema with field metadata, types, and picklist values',
    fields: {
      table: {type: 'string', description: 'Table name'},
      label: {type: 'string', description: 'Display label'},
      custom: {type: 'boolean', description: 'Whether this is a custom table'},
      fieldCount: {type: 'integer', description: 'Number of fields'},
      fields: {type: 'array', description: 'Field metadata (name, label, type, required, references, picklist values)'},
    },
    example: {table: 'incident', label: 'Incident', custom: false, fieldCount: 85, fields: [{name: 'number', type: 'string'}]},
  }

  static override flagCategories: FlagCategorization = {
    'include-choices': ['output'],
    'field-filter': ['filtering'],
    json: ['output'],
    'instance-url': ['auth'],
    'access-token': ['auth'],
    'service-account': ['auth'],
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 2,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override args = {
    table: Args.string({
      description: 'ServiceNow table name to describe',
      required: true,
    }),
  }

  static override flags = {
    ...ServiceNowBaseCommand.baseFlags,
    ...ServiceNowBaseCommand.canonicalFlags,
    'include-choices': Flags.boolean({
      description:
        'Include picklist/choice values for choice fields ' +
        '(default: true — pass --no-include-choices to skip)',
      default: true,
      allowNo: true,
    }),
    'field-filter': Flags.string({
      description: 'Filter fields by type (e.g., reference, string, boolean, picklist)',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args, flags} = await this.parse(DataDescribe)
    const canon = flags.canonical ? await this.resolveCanonical(flags, args.table) : undefined
    const table = canon ? canon.entity : args.table

    try {
      const client = await this.getConnection()
      const desc = await describeServiceNowTable(client, table)

      let fields = desc.fields

      // Apply field type filter
      if (flags['field-filter']) {
        fields = fields.filter(f => f.type === flags['field-filter'])
      }

      // Enrich choice fields with picklist values. Default: on, because
      // without this the chat widget's form builder renders state /
      // priority / severity as blank number inputs and users end up
      // submitting invalid choice values that ServiceNow silently drops.
      // Fetched in parallel across the full table hierarchy so
      // inherited fields (e.g. ``state`` on ``incident`` is declared on
      // ``task``) resolve their choices correctly.
      if (flags['include-choices']) {
        const choiceFields = fields.filter(f => f.type === 'picklist')
        const fetched = await Promise.all(
          choiceFields.map(f =>
            getFieldChoices(client, desc.tableChain, f.name).catch(() => []),
          ),
        )
        choiceFields.forEach((field, idx) => {
          field.picklistValues = fetched[idx]
        })
      }

      await this.outputResult({
        ...(canon ? {canonical: {...canon.context, fields: canon.toNative}} : {}),
        table: args.table,
        label: desc.label,
        custom: desc.custom,
        fieldCount: fields.length,
        fields: fields.map(f => ({
          name: f.name,
          label: f.label,
          type: f.type,
          length: f.length,
          required: !f.nillable,
          createable: f.createable,
          updateable: f.updateable,
          referenceTo: f.referenceTo.length > 0 ? f.referenceTo : undefined,
          picklistValues: f.picklistValues.length > 0
            ? f.picklistValues.filter(pv => pv.active).map(pv => ({value: pv.value, label: pv.label}))
            : undefined,
        })),
      }, this.buildContext({
        returned: fields.length,
        availableFields: fields.map(f => f.name),
        relatedCommands: [
          `$BIN servicenow data query --table ${args.table} --limit 5 --json`,
          `$BIN servicenow discover --table ${args.table} --verbose`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
