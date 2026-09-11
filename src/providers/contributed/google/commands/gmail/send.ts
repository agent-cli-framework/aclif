// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import {buildRawMessage} from '../../message-builder.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class GmailSend extends GoogleBaseCommand {
  static override description = 'Compose and send a Gmail message'

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: true,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Send a simple email',
      command: '$BIN google gmail send --to "user@example.com" --subject "Meeting" --body "Let\'s meet tomorrow" --confirm',
      responseShape: {id: '18f0abc123', threadId: '18f0abc123', labelIds: ['SENT']},
    },
    {
      description: 'Send with CC recipients',
      command: '$BIN google gmail send --to "user@example.com" --cc "manager@example.com" --subject "Report" --body "Attached" --confirm',
    },
    {
      description: 'Preview without sending (dry run)',
      command: '$BIN google gmail send --to "user@example.com" --subject "Test" --body "Hello" --dry-run',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Sent message confirmation',
    fields: {
      id: {type: 'string', description: 'ID of the sent message'},
      threadId: {type: 'string', description: 'Thread ID'},
      labelIds: {type: 'array', description: 'Labels applied to the sent message'},
    },
    example: {id: '18f0abc', threadId: '18f0abc', labelIds: ['SENT']},
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
    const {flags} = await this.parse(GmailSend)

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

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {raw},
      })

      await this.outputResult({
        id: response.data.id,
        threadId: response.data.threadId,
        labelIds: response.data.labelIds,
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google gmail get --message-id ${response.data.id}`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
