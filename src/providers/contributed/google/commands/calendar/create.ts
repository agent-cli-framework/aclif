// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class CalendarCreate extends GoogleBaseCommand {
  static override description = 'Create a Google Calendar event'

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Create a meeting',
      command: '$BIN google calendar create --summary "Team Meeting" --start "2026-04-11T10:00:00Z" --end "2026-04-11T11:00:00Z"',
      responseShape: {id: 'evt456', summary: 'Team Meeting', status: 'confirmed', htmlLink: 'https://calendar.google.com/...'},
    },
    {
      description: 'Create with attendees and location',
      command: '$BIN google calendar create --summary "Lunch" --start "2026-04-11T12:00:00Z" --end "2026-04-11T13:00:00Z" --attendees "alice@example.com,bob@example.com" --location "Cafe"',
    },
    {
      description: 'Create all-day event',
      command: '$BIN google calendar create --summary "Company Holiday" --start "2026-04-15" --end "2026-04-16" --all-day',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Created event details',
    fields: {
      id: {type: 'string', description: 'Event ID'},
      summary: {type: 'string', description: 'Event title'},
      start: {type: 'string', description: 'Start time'},
      end: {type: 'string', description: 'End time'},
      status: {type: 'string', description: 'Event status'},
      htmlLink: {type: 'string', description: 'Link to event in Google Calendar'},
    },
    example: {id: 'evt456', summary: 'Team Meeting', start: '2026-04-11T10:00:00Z', end: '2026-04-11T11:00:00Z', status: 'confirmed'},
  }

  static override flagCategories: FlagCategorization = {
    summary: ['bulk'],
    start: ['bulk'],
    end: ['bulk'],
    description: ['bulk'],
    location: ['bulk'],
    attendees: ['bulk'],
    'calendar-id': ['filtering'],
    'all-day': ['bulk'],
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
    summary: Flags.string({
      description: 'Event title',
      required: true,
    }),
    start: Flags.string({
      description: 'Start time (RFC3339 for timed events, YYYY-MM-DD for all-day)',
      required: true,
    }),
    end: Flags.string({
      description: 'End time (RFC3339 for timed events, YYYY-MM-DD for all-day)',
      required: true,
    }),
    description: Flags.string({
      description: 'Event description',
    }),
    location: Flags.string({
      description: 'Event location',
    }),
    attendees: Flags.string({
      description: 'Comma-separated attendee email addresses',
    }),
    'calendar-id': Flags.string({
      description: 'Calendar ID (default: primary)',
      default: 'primary',
    }),
    'all-day': Flags.boolean({
      description: 'Create an all-day event (start/end should be YYYY-MM-DD)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(CalendarCreate)

    if (this.isDryRun(flags, {
      summary: flags.summary, start: flags.start, end: flags.end,
      attendees: flags.attendees, location: flags.location,
    })) return

    try {
      const conn = await this.getConnection()
      const calProxy = conn.calendar()
      const cal = await calProxy.getClient() as import('@googleapis/calendar').calendar_v3.Calendar

      const eventBody: Record<string, unknown> = {
        summary: flags.summary,
      }

      if (flags['all-day']) {
        eventBody.start = {date: flags.start}
        eventBody.end = {date: flags.end}
      } else {
        eventBody.start = {dateTime: flags.start}
        eventBody.end = {dateTime: flags.end}
      }

      if (flags.description) eventBody.description = flags.description
      if (flags.location) eventBody.location = flags.location
      if (flags.attendees) {
        eventBody.attendees = flags.attendees.split(',').map(email => ({email: email.trim()}))
      }

      const insertParams: import('@googleapis/calendar').calendar_v3.Params$Resource$Events$Insert = {
        calendarId: flags['calendar-id'],
        requestBody: eventBody,
      }
      const response = await cal.events.insert(insertParams)

      const event = response.data

      await this.outputResult({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        status: event.status,
        htmlLink: event.htmlLink,
        attendees: event.attendees?.map(a => ({email: a.email, responseStatus: a.responseStatus})),
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google calendar get --event-id ${event.id}`,
          `$BIN google calendar update --event-id ${event.id} --summary "..." --json`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
