// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class GmailQuery extends GoogleBaseCommand {
  static override description = 'Search Gmail messages using Gmail search operators'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 2, // list + batch get
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Search unread messages',
      command: '$BIN google gmail query --query "is:unread" --limit 10',
      responseShape: {resultSizeEstimate: 42, messages: [{id: '18f...', threadId: '18f...', from: 'boss@example.com', subject: 'Q4 Report', snippet: 'Please review...', date: '2026-04-09T14:30:00Z'}]},
    },
    {
      description: 'Messages from a specific sender',
      command: '$BIN google gmail query --query "from:alice@example.com" --limit 5',
    },
    {
      description: 'Messages with attachments after a date',
      command: '$BIN google gmail query --query "has:attachment after:2026/01/01" --limit 20',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Gmail search results with message summaries',
    fields: {
      query: {type: 'string', description: 'The Gmail search query used'},
      resultSizeEstimate: {type: 'integer', description: 'Estimated total matching messages'},
      messages: {type: 'array', description: 'Array of message summaries (id, threadId, from, to, subject, date, snippet)'},
    },
    example: {query: 'is:unread', resultSizeEstimate: 10, messages: [{id: '18f0abc', threadId: '18f0abc', from: 'sender@example.com', subject: 'Hello', date: '2026-04-09T14:30:00Z', snippet: 'Preview text...'}]},
  }

  static override flagCategories: FlagCategorization = {
    query: ['filtering'],
    limit: ['filtering', 'pagination'],
    'page-token': ['pagination'],
    'label-ids': ['filtering'],
    fields: ['output'],
    truncate: ['output'],
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
      description: 'Gmail search query (e.g., "from:user@example.com is:unread")',
      required: true,
      char: 'q',
    }),
    limit: Flags.integer({
      description: 'Maximum number of messages to return',
      default: 10,
    }),
    'label-ids': Flags.string({
      description: 'Comma-separated label IDs to filter by (e.g., INBOX,UNREAD)',
    }),
    'page-token': Flags.string({
      description:
        'Opaque pageToken from a prior call\'s _context.pagination.nextCommand. ' +
        'Pass through verbatim to fetch the next page.',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(GmailQuery)

    if (this.isDryRun(flags, {query: flags.query, limit: flags.limit})) return

    try {
      const conn = await this.getConnection()
      const gmailProxy = conn.gmail()
      const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail

      // Step 1: List message IDs matching the query
      const listParams: import('@googleapis/gmail').gmail_v1.Params$Resource$Users$Messages$List = {
        userId: 'me',
        q: flags.query,
        maxResults: flags.limit,
      }
      if (flags['label-ids']) {
        listParams.labelIds = flags['label-ids'].split(',').map(l => l.trim())
      }
      if (flags['page-token']) {
        listParams.pageToken = flags['page-token']
      }

      const listResponse = await gmail.users.messages.list(listParams)
      const messageList = listResponse.data.messages || []
      const resultSizeEstimate = listResponse.data.resultSizeEstimate || 0
      const nextPageToken = listResponse.data.nextPageToken || null

      if (messageList.length === 0) {
        await this.outputResult({
          query: flags.query,
          resultSizeEstimate: 0,
          messages: [],
        }, this.buildContext({
          returned: 0,
          total: 0,
          refinements: ['Try broadening the search query', 'Use "in:anywhere" to search all folders'],
        }))
        return
      }

      // Step 2: Batch-fetch message details
      const messages = await Promise.all(
        messageList.map(async (msg: {id?: string | null; threadId?: string | null}) => {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Cc'],
          })

          const headers = detail.data.payload?.headers || []
          const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

          return {
            id: detail.data.id,
            threadId: detail.data.threadId,
            from: getHeader('From'),
            to: getHeader('To'),
            cc: getHeader('Cc') || undefined,
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            snippet: detail.data.snippet,
            labelIds: detail.data.labelIds,
          }
        }),
      )

      // The Gmail API returns a nextPageToken when more results are
      // available; absence of the token is the canonical "no more pages"
      // signal. resultSizeEstimate is unreliable (often inflated) so we
      // gate hasMore on the token, not the count.
      const hasMore = Boolean(nextPageToken)
      const escapedQuery = flags.query.replace(/"/g, '\\"')
      const nextCommand = hasMore
        ? `$BIN google gmail query --query "${escapedQuery}" ` +
          `--limit ${flags.limit}` +
          (flags['label-ids'] ? ` --label-ids "${flags['label-ids']}"` : '') +
          ` --page-token "${nextPageToken}"`
        : null

      await this.outputResult({
        query: flags.query,
        resultSizeEstimate,
        messages,
      }, this.buildContext({
        returned: messages.length,
        total: resultSizeEstimate,
        hasMore,
        nextCommand,
        relatedCommands: messages.length > 0
          ? [`$BIN google gmail get --message-id ${messages[0].id}`]
          : [],
        refinements: [
          'Add date filters: after:YYYY/MM/DD before:YYYY/MM/DD',
          'Filter by label: --label-ids INBOX,UNREAD',
          'Use --fields to reduce response size',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
