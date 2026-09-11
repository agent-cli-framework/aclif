// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class CalendarDelete extends GoogleBaseCommand {
  static override description = 'Delete a Google Calendar event'

  static override aciMetadata: AciMetadata = {
    mutability: 'delete',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: true,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Delete an event',
      command: '$BIN google calendar delete --event-id evt123 --confirm',
      responseShape: {deleted: true, eventId: 'evt123'},
    },
    {
      description: 'Preview deletion (dry run)',
      command: '$BIN google calendar delete --event-id evt123 --dry-run',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Delete confirmation',
    fields: {
      deleted: {type: 'boolean', description: 'Whether the event was successfully deleted'},
      eventId: {type: 'string', description: 'ID of the deleted event'},
      calendarId: {type: 'string', description: 'Calendar the event was deleted from'},
    },
    example: {deleted: true, eventId: 'evt123', calendarId: 'primary'},
  }

  static override flagCategories: FlagCategorization = {
    'event-id': ['filtering'],
    'calendar-id': ['filtering'],
    json: ['output'],
    'service-account-key': ['auth'],
    'delegated-user': ['auth'],
    'gw-client-id': ['auth'],
    'gw-client-secret': ['auth'],
    'refresh-token': ['auth'],
    'access-token': ['auth'],
    'service-account': ['auth'],
  }

  static override flags = {
    ...GoogleBaseCommand.baseFlags,
    'event-id': Flags.string({
      description: 'Google Calendar event ID to delete',
      required: true,
    }),
    'calendar-id': Flags.string({
      description: 'Calendar ID (default: primary)',
      default: 'primary',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(CalendarDelete)

    if (this.isDryRun(flags, {eventId: flags['event-id'], calendarId: flags['calendar-id']})) return

    try {
      const conn = await this.getConnection()
      const calProxy = conn.calendar()
      const cal = await calProxy.getClient() as import('@googleapis/calendar').calendar_v3.Calendar

      await cal.events.delete({
        calendarId: flags['calendar-id'],
        eventId: flags['event-id'],
      })

      await this.outputResult({
        deleted: true,
        eventId: flags['event-id'],
        calendarId: flags['calendar-id'],
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          '$BIN google calendar query --json',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
