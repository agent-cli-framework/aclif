// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import {buildRawMessage} from '../../message-builder.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class GmailReply extends GoogleBaseCommand {
  static override description = 'Reply to a Gmail thread'

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 2, // get original + send reply
    requiresConfirmation: true,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Reply to a thread',
      command: '$BIN google gmail reply --thread-id 18f0abc --message-id 18f0abc123 --body "Thanks, will review." --confirm',
      responseShape: {id: '18f0def456', threadId: '18f0abc', labelIds: ['SENT']},
    },
    {
      description: 'Reply to all recipients',
      command: '$BIN google gmail reply --thread-id 18f0abc --message-id 18f0abc123 --body "Agreed." --reply-all --confirm',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Reply confirmation with message and thread IDs',
    fields: {
      id: {type: 'string', description: 'ID of the reply message'},
      threadId: {type: 'string', description: 'Thread ID'},
      labelIds: {type: 'array', description: 'Labels applied to the reply'},
    },
    example: {id: '18f0def', threadId: '18f0abc', labelIds: ['SENT']},
  }

  static override flagCategories: FlagCategorization = {
    'thread-id': ['filtering'],
    'message-id': ['filtering'],
    body: ['bulk'],
    'reply-all': ['bulk'],
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
    'thread-id': Flags.string({
      description: 'Gmail thread ID to reply to',
      required: true,
    }),
    'message-id': Flags.string({
      description: 'Gmail message ID to reply to (for In-Reply-To header)',
      required: true,
    }),
    body: Flags.string({
      description: 'Reply body text',
      required: true,
    }),
    'reply-all': Flags.boolean({
      description: 'Reply to all recipients (To + CC)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(GmailReply)

    if (this.isDryRun(flags, {threadId: flags['thread-id'], messageId: flags['message-id'], body: flags.body, replyAll: flags['reply-all']})) return

    try {
      const conn = await this.getConnection()
      const gmailProxy = conn.gmail()
      const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail

      // Fetch the original message to get headers for threading
      const original = await gmail.users.messages.get({
        userId: 'me',
        id: flags['message-id'],
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Message-ID'],
      })

      const headers = original.data.payload?.headers || []
      const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

      const originalFrom = getHeader('From')
      const originalTo = getHeader('To')
      const originalCc = getHeader('Cc')
      const originalSubject = getHeader('Subject')
      const originalMessageId = getHeader('Message-ID')

      // Build reply recipients
      let to = originalFrom
      let cc: string | undefined
      if (flags['reply-all']) {
        // Include all original recipients except ourselves
        const allRecipients = [originalTo, originalCc].filter(Boolean).join(', ')
        cc = allRecipients || undefined
      }

      // Build subject with Re: prefix
      const subject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`

      const raw = buildRawMessage({
        to,
        subject,
        body: flags.body,
        cc,
        inReplyTo: originalMessageId,
        references: originalMessageId,
      })

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw,
          threadId: flags['thread-id'],
        },
      })

      await this.outputResult({
        id: response.data.id,
        threadId: response.data.threadId,
        labelIds: response.data.labelIds,
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google gmail get --message-id ${response.data.id}`,
          `$BIN google gmail query --query "thread:${flags['thread-id']}" --json`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
