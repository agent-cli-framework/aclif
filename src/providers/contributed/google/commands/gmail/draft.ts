// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import {buildRawMessage} from '../../message-builder.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/**
 * Save a message as a Gmail draft without sending it. A person opens the
 * draft in Gmail and sends it, so nothing leaves the mailbox from this
 * command. Needs `gmail.compose` or `gmail.modify`; `gmail.send` alone is
 * not enough for drafts.create.
 */
export default class GmailDraft extends GoogleBaseCommand {
  static override description = 'Save a Gmail message as a draft without sending it'

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
      description: 'Save a draft for a person to review and send',
      command: '$BIN google gmail draft --to "alice@example.com" --subject "Filing due Friday" --body "The reply brief is due Friday." --json',
      responseShape: {id: 'r-5829301', messageId: '18f0abc123', threadId: '18f0abc123', labelIds: ['DRAFT']},
    },
    {
      description: 'Draft to several recipients with a CC',
      command: '$BIN google gmail draft --to "alice@example.com,bob@example.com" --cc "manager@example.com" --subject "Status" --body "Summary below." --json',
    },
    {
      description: 'Preview the draft without saving it (dry run)',
      command: '$BIN google gmail draft --to "alice@example.com" --subject "Test" --body "Hello" --dry-run',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Saved draft',
    fields: {
      id: {type: 'string', description: 'Draft ID (used to update, send, or delete the draft)'},
      messageId: {type: 'string', description: 'ID of the message inside the draft'},
      threadId: {type: 'string', description: 'Thread ID'},
      labelIds: {type: 'array', description: 'Labels on the draft message'},
    },
    example: {id: 'r-5829301', messageId: '18f0abc', threadId: '18f0abc', labelIds: ['DRAFT']},
  }

  static override flagCategories: FlagCategorization = {
    to: ['bulk'],
    subject: ['bulk'],
    body: ['bulk'],
    cc: ['bulk'],
    bcc: ['bulk'],
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
    to: Flags.string({
      description: 'Recipient email address(es), comma-separated',
      required: true,
    }),
    subject: Flags.string({
      description: 'Email subject line',
      required: true,
    }),
    body: Flags.string({
      description: 'Email body text',
      required: true,
    }),
    cc: Flags.string({
      description: 'CC recipient email address(es), comma-separated',
    }),
    bcc: Flags.string({
      description: 'BCC recipient email address(es), comma-separated',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(GmailDraft)

    if (this.isDryRun(flags, {to: flags.to, subject: flags.subject, body: flags.body, cc: flags.cc, bcc: flags.bcc})) return

    try {
      const conn = await this.getConnection()
      const gmailProxy = conn.gmail()
      const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail

      const raw = buildRawMessage({
        to: flags.to,
        subject: flags.subject,
        body: flags.body,
        cc: flags.cc,
        bcc: flags.bcc,
      })

      const response = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {message: {raw}},
      })

      const message = response.data.message
      await this.outputResult({
        id: response.data.id,
        messageId: message?.id,
        threadId: message?.threadId,
        labelIds: message?.labelIds,
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google gmail get --message-id ${message?.id}`,
          '$BIN google gmail query --query "in:drafts" --json',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
