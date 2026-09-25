// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

const ALL_DAY_DATE = /^\d{4}-\d{2}-\d{2}$/

export default class CalendarUpdate extends GoogleBaseCommand {
  static override description = 'Update a Google Calendar event'

  static override aciMetadata: AciMetadata = {
    mutability: 'update',
    idempotent: true,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 2, // get + patch
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Update event title',
      command: '$BIN google calendar update --event-id evt123 --summary "Updated Meeting"',
      responseShape: {id: 'evt123', summary: 'Updated Meeting', status: 'confirmed'},
    },
    {
      description: 'Reschedule an event',
      command: '$BIN google calendar update --event-id evt123 --start "2026-04-12T14:00:00Z" --end "2026-04-12T15:00:00Z"',
    },
    {
      description: 'Move an all-day event to another day (end is exclusive)',
      command: '$BIN google calendar update --event-id evt123 --start "2026-04-14" --end "2026-04-15" --all-day',
    },
    {
      description: 'Add attendees',
      command: '$BIN google calendar update --event-id evt123 --attendees "newperson@example.com"',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Updated event details',
    fields: {
      id: {type: 'string', description: 'Event ID'},
      summary: {type: 'string', description: 'Event title'},
      start: {type: 'string', description: 'Start time'},
      end: {type: 'string', description: 'End time'},
      status: {type: 'string', description: 'Event status'},
      updated: {type: 'string', description: 'Last modified timestamp'},
    },
    example: {id: 'evt123', summary: 'Updated Meeting', start: '2026-04-12T14:00:00Z', end: '2026-04-12T15:00:00Z', status: 'confirmed'},
  }

  static override flagCategories: FlagCategorization = {
    'event-id': ['filtering'],
    'calendar-id': ['filtering'],
    summary: ['bulk'],
    start: ['bulk'],
    end: ['bulk'],
    description: ['bulk'],
    location: ['bulk'],
    attendees: ['bulk'],
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
    'event-id': Flags.string({
      description: 'Google Calendar event ID to update',
      required: true,
    }),
    'calendar-id': Flags.string({
      description: 'Calendar ID (default: primary)',
      default: 'primary',
    }),
    summary: Flags.string({
      description: 'Updated event title',
    }),
    start: Flags.string({
      description: 'Updated start time (RFC3339 for timed events, YYYY-MM-DD with --all-day)',
    }),
    end: Flags.string({
      description: 'Updated end time (RFC3339 for timed events, YYYY-MM-DD with --all-day; exclusive for all-day)',
    }),
    description: Flags.string({
      description: 'Updated event description',
    }),
    location: Flags.string({
      description: 'Updated event location',
    }),
    attendees: Flags.string({
      description: 'Comma-separated attendee email addresses (replaces existing)',
    }),
    'all-day': Flags.boolean({
      description: 'Make it an all-day event: --start and --end are YYYY-MM-DD dates (both required)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(CalendarUpdate)

    if (flags['all-day']) {
      if (!flags.start || !flags.end) {
        this.error('--all-day needs both --start and --end as YYYY-MM-DD dates.', {exit: 2})
      }
      if (!ALL_DAY_DATE.test(flags.start) || !ALL_DAY_DATE.test(flags.end)) {
        this.error('With --all-day, --start and --end must be YYYY-MM-DD dates.', {exit: 2})
      }
    }

    // A patch merges into the stored start/end, so the other form is set
    // to null; otherwise a timed event moved to all-day (or back) would
    // hold both date and dateTime, which the API rejects.
    const when = (value: string) => flags['all-day'] ? {date: value, dateTime: null} : {dateTime: value, date: null}
    const updates: Record<string, unknown> = {}
    if (flags.summary) updates.summary = flags.summary
    if (flags.start) updates.start = when(flags.start)
    if (flags.end) updates.end = when(flags.end)
    if (flags.description) updates.description = flags.description
    if (flags.location) updates.location = flags.location
    if (flags.attendees) {
      updates.attendees = flags.attendees.split(',').map(email => ({email: email.trim()}))
    }

    if (Object.keys(updates).length === 0) {
      this.error('No update fields provided. Use --summary, --start, --end, --description, --location, or --attendees.', {exit: 2})
    }

    if (this.isDryRun(flags, {eventId: flags['event-id'], updates})) return

    try {
      const conn = await this.getConnection()
      const calProxy = conn.calendar()
      const cal = await calProxy.getClient() as import('@googleapis/calendar').calendar_v3.Calendar

      const patchParams: import('@googleapis/calendar').calendar_v3.Params$Resource$Events$Patch = {
        calendarId: flags['calendar-id'],
        eventId: flags['event-id'],
        requestBody: updates,
      }
      const response = await cal.events.patch(patchParams)

      const event = response.data

      await this.outputResult({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        status: event.status,
        updated: event.updated,
        htmlLink: event.htmlLink,
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google calendar get --event-id ${event.id}`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
