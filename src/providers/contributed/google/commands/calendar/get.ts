// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class CalendarGet extends GoogleBaseCommand {
  static override description = 'Get a single Google Calendar event by ID'

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
      description: 'Get event details',
      command: '$BIN google calendar get --event-id evt123',
      responseShape: {id: 'evt123', summary: 'Team Meeting', start: '2026-04-10T10:00:00Z', end: '2026-04-10T11:00:00Z'},
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Full calendar event details',
    fields: {
      id: {type: 'string', description: 'Event ID'},
      summary: {type: 'string', description: 'Event title'},
      description: {type: 'string', nullable: true, description: 'Event description'},
      start: {type: 'string', description: 'Start time (RFC3339)'},
      end: {type: 'string', description: 'End time (RFC3339)'},
      status: {type: 'string', description: 'Event status (confirmed, tentative, cancelled)'},
      attendees: {type: 'array', description: 'List of attendees'},
    },
    example: {id: 'evt123', summary: 'Meeting', start: '2026-04-10T10:00:00Z', end: '2026-04-10T11:00:00Z', status: 'confirmed'},
  }

  static override flagCategories: FlagCategorization = {
    'event-id': ['filtering'],
    'calendar-id': ['filtering'],
    fields: ['output'],
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
      description: 'Google Calendar event ID',
      required: true,
    }),
    'calendar-id': Flags.string({
      description: 'Calendar ID (default: primary)',
      default: 'primary',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(CalendarGet)

    if (this.isDryRun(flags, {eventId: flags['event-id'], calendarId: flags['calendar-id']})) return

    try {
      const conn = await this.getConnection()
      const calProxy = conn.calendar()
      const cal = await calProxy.getClient() as import('@googleapis/calendar').calendar_v3.Calendar

      const response = await cal.events.get({
        calendarId: flags['calendar-id'],
        eventId: flags['event-id'],
      })

      const event = response.data

      await this.outputResult({
        id: event.id,
        summary: event.summary,
        description: event.description || undefined,
        location: event.location || undefined,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        status: event.status,
        organizer: event.organizer ? {email: event.organizer.email, displayName: event.organizer.displayName} : undefined,
        creator: event.creator ? {email: event.creator.email, displayName: event.creator.displayName} : undefined,
        attendees: event.attendees?.map(a => ({
          email: a.email,
          displayName: a.displayName || undefined,
          responseStatus: a.responseStatus,
          organizer: a.organizer || undefined,
          self: a.self || undefined,
        })),
        recurrence: event.recurrence || undefined,
        htmlLink: event.htmlLink,
        created: event.created,
        updated: event.updated,
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google calendar update --event-id ${event.id} --summary "..." --json`,
          `$BIN google calendar delete --event-id ${event.id} --json`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
