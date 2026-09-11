// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {ProviderMetadata} from '../../../core/contract/aci.js'

export const googleMetadata: ProviderMetadata = {
  name: 'google',
  description: 'Google Workspace operations (Gmail, Calendar, Drive)',
  overview: 'Google Workspace and personal Gmail. Gmail for email, Calendar for scheduling, Drive for files. Auth via OAuth2 refresh token (personal Gmail), Service Account with Domain-Wide Delegation (Workspace orgs), or pre-obtained access token.',
  querySyntax: 'Per-service native syntax. Gmail: search operators (from:x subject:y is:unread after:YYYY/MM/DD). Calendar: time range flags + text query. Drive: query strings (name contains "x", mimeType = "...").',
  providerSpecificFlags: [
    '--gw-client-id + --gw-client-secret + --refresh-token — OAuth2 refresh token (personal Gmail) (or GW_CLIENT_ID, GW_CLIENT_SECRET, GW_REFRESH_TOKEN)',
    '--service-account-key + --delegated-user — Service Account with Domain-Wide Delegation (Workspace orgs) (or GW_SERVICE_ACCOUNT_KEY, GW_DELEGATED_USER)',
    '--access-token — Pre-obtained OAuth2 access token, short-lived (or GW_ACCESS_TOKEN)',
  ],
  topics: {
    drive: {
      description: 'Links to Google Drive files',
      commands: ['view-url'],
      keyFields: ['id', 'url'],
      commonPatterns: [
        'Open a Drive file: $BIN google drive view-url --file-id 1AbC --json',
      ],
    },
    gmail: {
      description: 'Search, read, and send Gmail messages',
      commands: ['query', 'get', 'send', 'reply', 'get-attachment', 'import', 'profile'],
      keyFields: ['id', 'threadId', 'from', 'to', 'subject', 'date', 'snippet'],
      commonPatterns: [
        'Search messages: $BIN google gmail query --query "from:boss@example.com is:unread" --limit 10 --json',
        'Get message: $BIN google gmail get --message-id <id> --json',
        'Send email: $BIN google gmail send --to "user@example.com" --subject "Hello" --body "..." --json',
        'Reply to thread: $BIN google gmail reply --thread-id <id> --message-id <id> --body "..." --json',
      ],
    },
    calendar: {
      description: 'List, create, update, and delete Google Calendar events',
      commands: ['query', 'get', 'create', 'update', 'delete'],
      keyFields: ['id', 'summary', 'start', 'end', 'attendees', 'status', 'organizer'],
      commonPatterns: [
        'List this week: $BIN google calendar query --time-min 2026-04-10T00:00:00Z --time-max 2026-04-17T00:00:00Z --json',
        'Search events: $BIN google calendar query --query "standup" --limit 10 --json',
        'Create event: $BIN google calendar create --summary "Team Meeting" --start "2026-04-11T10:00:00Z" --end "2026-04-11T11:00:00Z" --json',
        'Update event: $BIN google calendar update --event-id <id> --summary "Updated Meeting" --json',
        'Delete event: $BIN google calendar delete --event-id <id> --json',
      ],
    },
  },
}
