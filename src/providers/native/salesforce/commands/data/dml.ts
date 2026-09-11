// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataDml extends SalesforceBaseCommand {
  static override description = 'Insert, update, delete, or upsert Salesforce records'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Insert a new account',
      command: '$BIN salesforce data dml insert Account --values \'{"Name":"Test Corp","Industry":"Technology"}\'',
      responseShape: {operation: 'insert', result: {id: '001xx...', success: true}},
    },
    {
      description: 'Update a record',
      command: '$BIN salesforce data dml update Account --record-id 001xx000003GYRA --values \'{"Industry":"Finance"}\'',
    },
    {
      description: 'Delete a record',
      command: '$BIN salesforce data dml delete Account --record-id 001xx000003GYRA',
    },
    {
      description: 'Upsert with external ID',
      command: '$BIN salesforce data dml upsert Account --external-id-field ExtId__c --values \'[{"ExtId__c":"A1","Name":"Corp A"}]\'',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'DML operation result with success/failure per record',
    fields: {
      operation: {type: 'string', description: 'The DML operation performed (insert, update, delete, upsert)'},
      objectName: {type: 'string', description: 'Target Salesforce object'},
      result: {type: 'object', description: 'Operation result with id and success status'},
    },
    example: {operation: 'insert', objectName: 'Account', result: {id: '001xx000003GYRA', success: true}},
  }

  static override flagCategories: FlagCategorization = {
    values: ['bulk'],
    'record-id': ['filtering'],
    'external-id-field': ['bulk'],
    json: ['output'],
    'instance-url': ['auth'],
    'access-token': ['auth'],
    'service-account': ['auth'],
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override args = {
    operation: Args.string({
      description: 'DML operation to perform',
      required: true,
      options: ['insert', 'update', 'delete', 'upsert'],
    }),
    objectName: Args.string({
      description: 'Salesforce object API name',
      required: true,
    }),
  }

  static override flags = {
    ...SalesforceBaseCommand.baseFlags,
    values: Flags.string({
      description: 'JSON object or array of objects with field values',
      char: 'v',
    }),
    'record-id': Flags.string({
      description: 'Record ID (for update/delete)',
      char: 'r',
    }),
    'external-id-field': Flags.string({
      description: 'External ID field name (for upsert)',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {args, flags} = await this.parse(DataDml)
    const {operation, objectName} = args

    if (this.isDryRun(flags, {operation, objectName, values: flags.values, recordId: flags['record-id']})) return

    try {
      const conn = await this.getConnection()
      const sobject = conn.sobject(objectName)

      switch (operation) {
      case 'insert': {
        if (!flags.values) this.error('--values is required for insert', {exit: 2})
        const data = JSON.parse(flags.values)
        const result = await sobject.create(data)
        await this.outputResult({operation: 'insert', objectName, result}, this.buildContext({
          returned: Array.isArray(result) ? result.length : 1,
          relatedCommands: [`$BIN salesforce data query --query "SELECT Id, Name FROM ${objectName} ORDER BY CreatedDate DESC LIMIT 5"`],
        }))
        break
      }

      case 'update': {
        if (!flags.values) this.error('--values is required for update', {exit: 2})
        const data = JSON.parse(flags.values)
        if (flags['record-id'] && !data.Id) data.Id = flags['record-id']
        if (!data.Id && !Array.isArray(data)) this.error('--record-id or Id in --values is required for update', {exit: 2})
        const result = await sobject.update(data)
        await this.outputResult({operation: 'update', objectName, result})
        break
      }

      case 'delete': {
        if (!flags['record-id']) this.error('--record-id is required for delete', {exit: 2})
        const result = await sobject.destroy(flags['record-id'])
        await this.outputResult({operation: 'delete', objectName, recordId: flags['record-id'], result})
        break
      }

      case 'upsert': {
        if (!flags.values) this.error('--values is required for upsert', {exit: 2})
        if (!flags['external-id-field']) this.error('--external-id-field is required for upsert', {exit: 2})
        const data = JSON.parse(flags.values)
        const result = await sobject.upsert(data, flags['external-id-field'])
        await this.outputResult({operation: 'upsert', objectName, externalIdField: flags['external-id-field'], result})
        break
      }
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
