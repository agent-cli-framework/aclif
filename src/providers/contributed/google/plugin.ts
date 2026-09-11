// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Google Workspace provider plugin: the one file the registry imports.
 */
import {defineProvider} from '../../../core/provider/plugin.js'
import type {ProviderCommandClass} from '../../../core/provider/plugin.js'
import {cacheKey, createClient} from './client.js'
import {googleCredentials} from './credentials.js'
import {classifyGoogleError} from './errors.js'
import {googleMetadata} from './metadata.js'
import GoogleCalendarCreate from './commands/calendar/create.js'
import GoogleCalendarDelete from './commands/calendar/delete.js'
import GoogleCalendarGet from './commands/calendar/get.js'
import GoogleCalendarQuery from './commands/calendar/query.js'
import GoogleCalendarUpdate from './commands/calendar/update.js'
import GoogleDiscover from './commands/discover.js'
import GoogleDriveViewUrl from './commands/drive/view-url.js'
import GoogleGmailGet from './commands/gmail/get.js'
import GoogleGmailGetAttachment from './commands/gmail/get-attachment.js'
import GoogleGmailImport from './commands/gmail/import.js'
import GoogleGmailProfile from './commands/gmail/profile.js'
import GoogleGmailQuery from './commands/gmail/query.js'
import GoogleGmailReply from './commands/gmail/reply.js'
import GoogleGmailSend from './commands/gmail/send.js'
import GoogleIntrospect from './commands/introspect.js'

export const googlePlugin = defineProvider({
  name: 'google',
  displayName: 'Google Workspace',
  description: 'Google Workspace: Gmail, Calendar, Drive',
  maintainers: ['chrismarino'],
  metadata: googleMetadata,
  credentials: googleCredentials,
  createClient,
  cacheKey,
  classifyError: classifyGoogleError,
  healthProbe: ['google', 'gmail', 'profile'],
  commands: {
    'google:calendar:create': GoogleCalendarCreate,
    'google:calendar:delete': GoogleCalendarDelete,
    'google:calendar:get': GoogleCalendarGet,
    'google:calendar:query': GoogleCalendarQuery,
    'google:calendar:update': GoogleCalendarUpdate,
    'google:discover': GoogleDiscover,
    'google:drive:view-url': GoogleDriveViewUrl,
    'google:gmail:get': GoogleGmailGet,
    'google:gmail:get-attachment': GoogleGmailGetAttachment,
    'google:gmail:import': GoogleGmailImport,
    'google:gmail:profile': GoogleGmailProfile,
    'google:gmail:query': GoogleGmailQuery,
    'google:gmail:reply': GoogleGmailReply,
    'google:gmail:send': GoogleGmailSend,
    'google:introspect': GoogleIntrospect,
  } as Record<string, ProviderCommandClass>,
})
