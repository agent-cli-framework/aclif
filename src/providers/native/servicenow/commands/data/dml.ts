// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'

import {ServiceNowBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class DataDml extends ServiceNowBaseCommand {
  static override description = 'Insert, update, or delete ServiceNow records'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Create an incident',
      command: '$BIN servicenow data dml insert --table incident --values \'{"short_description":"Server down","urgency":"1"}\'',
      responseShape: {operation: 'insert', table: 'incident', result: {sys_id: 'abc123', number: 'INC0010042'}},
    },
    {
      description: 'Update a record',
      command: '$BIN servicenow data dml update --table incident --sys-id abc123 --values \'{"state":"2","assigned_to":"admin"}\'',
    },
    {
      description: 'Delete a record',
      command: '$BIN servicenow data dml delete --table incident --sys-id abc123',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'DML operation result with created/updated record or deletion confirmation',
    fields: {
      operation: {type: 'string', description: 'The DML operation performed (insert, update, delete)'},
      table: {type: 'string', description: 'Target table'},
      result: {type: 'object', nullable: true, description: 'Created or updated record (null for delete)'},
      sysId: {type: 'string', nullable: true, description: 'Record sys_id (for update/delete)'},
    },
    example: {operation: 'insert', table: 'incident', result: {sys_id: 'abc123', number: 'INC0010042'}},
  }

  static override flagCategories: FlagCategorization = {
    table: ['filtering'],
    values: ['bulk'],
    'sys-id': ['filtering'],
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
      options: ['insert', 'update', 'delete'],
    }),
  }

  static override flags = {
    ...ServiceNowBaseCommand.baseFlags,
    table: Flags.string({
      description: 'ServiceNow table name',
      required: true,
      char: 't',
    }),
    values: Flags.string({
      description: 'JSON object with field values (for insert/update)',
      char: 'v',
    }),
    'sys-id': Flags.string({
      description: 'Record sys_id (required for update/delete)',
      char: 'i',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {args, flags} = await this.parse(DataDml)
    const {operation} = args

    if (this.isDryRun(flags, {operation, table: flags.table, sysId: flags['sys-id'], values: flags.values})) return

    try {
      const client = await this.getConnection()

      switch (operation) {
      case 'insert': {
        if (!flags.values) this.error('--values is required for insert', {exit: 2})
        const data = JSON.parse(flags.values)
        const result = await client.tableCreate(flags.table, data)
        await this.outputResult({operation: 'insert', table: flags.table, result: result.result}, this.buildContext({
          returned: 1,
          relatedCommands: [
            `$BIN servicenow data query --table ${flags.table} --query "sys_id=${(result.result as Record<string, unknown>).sys_id}" --json`,
          ],
        }))
        break
      }

      case 'update': {
        if (!flags['sys-id']) this.error('--sys-id is required for update', {exit: 2})
        if (!flags.values) this.error('--values is required for update', {exit: 2})
        const data = JSON.parse(flags.values)
        const result = await client.tableUpdate(flags.table, flags['sys-id'], data)

        // Compare the requested values against the echoed record.
        // ServiceNow silently drops writes it doesn't like (invalid
        // choice values, fields blocked by business rules or ACLs,
        // closed-record edits, etc.) and still returns 200 with the
        // record body. Treat that as a FAILED update — surface a
        // structured error so the chat renders a red notification
        // instead of a misleading "success".
        const echoed = result.result as Record<string, unknown>
        const ignored: Array<{field: string; requested: unknown; actual: unknown}> = []
        for (const [field, requested] of Object.entries(data)) {
          const actual = echoed[field]
          // ServiceNow normalizes booleans to "true"/"false" strings and
          // returns reference fields as objects; compare as strings to
          // handle the common cases without false positives.
          const actualStr = typeof actual === 'object' && actual !== null
            ? JSON.stringify(actual)
            : String(actual ?? '')
          const requestedStr = String(requested ?? '')
          if (actualStr !== requestedStr) {
            ignored.push({field, requested, actual})
          }
        }

        if (ignored.length > 0) {
          this.outputError({
            code: 'SERVICENOW_SILENT_DROP',
            message:
              `ServiceNow accepted the PATCH but did not apply ` +
              `${ignored.length} field(s): ` +
              ignored.map(i =>
                `${i.field} (requested ${JSON.stringify(i.requested)}, ` +
                `actual ${JSON.stringify(i.actual)})`,
              ).join('; ') +
              '. This usually means an invalid choice value, a ' +
              'business rule / ACL blocked the write, or the record ' +
              'is in a state that prevents the change.',
          })
          break
        }

        await this.outputResult({
          operation: 'update',
          table: flags.table,
          sysId: flags['sys-id'],
          result: echoed,
        })
        break
      }

      case 'delete': {
        if (!flags['sys-id']) this.error('--sys-id is required for delete', {exit: 2})
        await client.tableDelete(flags.table, flags['sys-id'])
        await this.outputResult({operation: 'delete', table: flags.table, sysId: flags['sys-id'], deleted: true})
        break
      }
      }
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
