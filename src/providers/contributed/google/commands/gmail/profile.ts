// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/**
 * Return the authenticated user's Gmail profile.
 *
 * Wraps `gmail.users.getProfile` — a read-only endpoint that returns
 * the mailbox owner's email address and a few aggregate counters.
 * The most common use is resolving the demo / OAuth account's
 * address from automation that doesn't have it pre-configured (e.g.
 * seed scripts that need to import messages into "the current
 * mailbox").
 */
export default class GmailProfile extends GoogleBaseCommand {
  static override description = "Return the authenticated user's Gmail profile (email address + aggregate counts)"

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Resolve the current mailbox address',
      command: '$BIN google gmail profile --json',
      responseShape: {emailAddress: 'demo@example.com', messagesTotal: 12345, threadsTotal: 4321, historyId: '987654'},
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Mailbox profile',
    fields: {
      emailAddress: {type: 'string', description: 'Owner email address (the canonical "me" identity for this Gmail token)'},
      messagesTotal: {type: 'number', description: 'Total messages in the mailbox'},
      threadsTotal: {type: 'number', description: 'Total threads in the mailbox'},
      historyId: {type: 'string', description: 'Most recent history record ID — opaque token for the history.list endpoint'},
    },
    example: {emailAddress: 'demo@example.com', messagesTotal: 12345, threadsTotal: 4321, historyId: '987654'},
  }

  static override flagCategories: FlagCategorization = {
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
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(GmailProfile)

    if (this.isDryRun(flags, {})) return

    try {
      const conn = await this.getConnection()
      const gmailProxy = conn.gmail()
      const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail

      const response = await gmail.users.getProfile({userId: 'me'})

      await this.outputResult({
        emailAddress: response.data.emailAddress,
        messagesTotal: response.data.messagesTotal,
        threadsTotal: response.data.threadsTotal,
        historyId: response.data.historyId,
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google gmail query --q "in:inbox" --max-results 10`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
