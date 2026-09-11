// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class CalendarQuery extends GoogleBaseCommand {
  static override description = 'List or search Google Calendar events'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'List events this week',
      command: '$BIN google calendar query --time-min 2026-04-10T00:00:00Z --time-max 2026-04-17T00:00:00Z',
      responseShape: {events: [{id: 'evt123', summary: 'Standup', start: '2026-04-10T09:00:00Z', end: '2026-04-10T09:30:00Z'}]},
    },
    {
      description: 'Search events by text',
      command: '$BIN google calendar query --query "standup" --limit 10',
    },
    {
      description: 'List events from a specific calendar',
      command: '$BIN google calendar query --calendar-id "team@group.calendar.google.com" --time-min 2026-04-01T00:00:00Z',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Calendar event list',
    fields: {
      calendarId: {type: 'string', description: 'Calendar ID queried'},
      events: {type: 'array', description: 'Array of calendar events'},
    },
    example: {calendarId: 'primary', events: [{id: 'evt123', summary: 'Meeting', start: '2026-04-10T10:00:00Z', end: '2026-04-10T11:00:00Z', status: 'confirmed'}]},
  }

  static override flagCategories: FlagCategorization = {
    query: ['filtering'],
    'time-min': ['filtering'],
    'time-max': ['filtering'],
    'calendar-id': ['filtering'],
    limit: ['filtering', 'pagination'],
    'page-token': ['pagination'],
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
    query: Flags.string({
      description: 'Free text search terms for events',
      char: 'q',
    }),
    'calendar-id': Flags.string({
      description: 'Calendar ID (default: primary)',
      default: 'primary',
    }),
    'time-min': Flags.string({
      description: 'Lower bound (inclusive) for event start time (RFC3339, e.g., 2026-04-10T00:00:00Z)',
    }),
    'time-max': Flags.string({
      description: 'Upper bound (exclusive) for event start time (RFC3339)',
    }),
    limit: Flags.integer({
      description: 'Maximum number of events to return',
      default: 25,
    }),
    'page-token': Flags.string({
      description:
        'Opaque pageToken from a prior call\'s _context.pagination.nextCommand. ' +
        'Pass through verbatim to fetch the next page.',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(CalendarQuery)

    if (this.isDryRun(flags, {calendarId: flags['calendar-id'], query: flags.query, timeMin: flags['time-min'], timeMax: flags['time-max']})) return

    try {
      const conn = await this.getConnection()
      const calProxy = conn.calendar()
      const cal = await calProxy.getClient() as import('@googleapis/calendar').calendar_v3.Calendar

      const params: import('@googleapis/calendar').calendar_v3.Params$Resource$Events$List = {
        calendarId: flags['calendar-id'],
        maxResults: flags.limit,
        singleEvents: true,
        orderBy: 'startTime',
      }

      if (flags.query) params.q = flags.query
      if (flags['time-min']) params.timeMin = flags['time-min']
      if (flags['time-max']) params.timeMax = flags['time-max']
      if (flags['page-token']) params.pageToken = flags['page-token']

      const response = await cal.events.list(params)
      const items = response.data.items || []
      const nextPageToken = response.data.nextPageToken || null

      const events = items.map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description || undefined,
        location: event.location || undefined,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        status: event.status,
        organizer: event.organizer?.email,
        attendees: event.attendees?.map(a => ({
          email: a.email,
          responseStatus: a.responseStatus,
          organizer: a.organizer || undefined,
        })),
        htmlLink: event.htmlLink,
      }))

      const hasMore = Boolean(nextPageToken)
      // Re-emit the original filter flags verbatim so the next call
      // resolves to the same scope; only the page-token advances.
      const cmdParts = ['$BIN google calendar query']
      if (flags['calendar-id'] && flags['calendar-id'] !== 'primary') {
        cmdParts.push(`--calendar-id "${flags['calendar-id']}"`)
      }
      if (flags.query) cmdParts.push(`--query "${flags.query.replace(/"/g, '\\"')}"`)
      if (flags['time-min']) cmdParts.push(`--time-min ${flags['time-min']}`)
      if (flags['time-max']) cmdParts.push(`--time-max ${flags['time-max']}`)
      cmdParts.push(`--limit ${flags.limit}`)
      if (hasMore) cmdParts.push(`--page-token "${nextPageToken}"`)
      const nextCommand = hasMore ? cmdParts.join(' ') : null

      await this.outputResult({
        calendarId: flags['calendar-id'],
        events,
      }, this.buildContext({
        returned: events.length,
        hasMore,
        nextCommand,
        refinements: [
          'Use --time-min and --time-max to narrow by date range',
          'Use --query for text search within events',
          'Use --calendar-id to query a different calendar',
        ],
        relatedCommands: events.length > 0
          ? [`$BIN google calendar get --event-id ${events[0].id}`]
          : [],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
