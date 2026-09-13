// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {DocuSignBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class EnvelopesList extends DocuSignBaseCommand {
  static override description = 'List DocuSign envelopes (requires --from-date; defaults to 30 days ago)'

  static override aciExamples: CommandExample[] = [
    {
      description: 'List the 50 most recent envelopes',
      command: '$BIN docusign envelopes list --limit 50 --json',
      responseShape: {envelopes: [{envelopeId: 'abc-123', status: 'sent', emailSubject: 'Please sign'}], resultSetSize: '50'},
    },
    {
      description: 'List only completed envelopes from a specific date',
      command: '$BIN docusign envelopes list --from-date 2025-01-01 --status completed --json',
    },
    {
      description: 'List drafts',
      command: '$BIN docusign envelopes list --status created --json',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'List response with envelopes[] and paging metadata',
    fields: {
      envelopes: {type: 'array', description: 'Envelope summary records'},
      resultSetSize: {type: 'string', description: 'Number of envelopes returned'},
      totalSetSize: {type: 'string', nullable: true, description: 'Total matching envelopes (if known)'},
      startPosition: {type: 'string', nullable: true, description: 'Offset of the first record'},
    },
    example: {envelopes: [{envelopeId: 'xyz', status: 'sent', emailSubject: 'NDA'}], resultSetSize: '1'},
  }

  static override flagCategories: FlagCategorization = {
    'from-date': ['filtering'],
    status: ['filtering'],
    limit: ['filtering', 'pagination'],
    'start-position': ['pagination'],
    json: ['output'],
    'integration-key': ['auth'],
    'user-id': ['auth'],
    'account-id': ['auth'],
    'private-key': ['auth'],
    'service-account': ['auth'],
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override flags = {
    ...DocuSignBaseCommand.baseFlags,
    'from-date': Flags.string({
      description: 'ISO-8601 date — include envelopes last changed on or after this date (default: 30 days ago)',
    }),
    status: Flags.string({
      description: 'Filter by envelope status — single value or comma-separated list (e.g. "sent,delivered" or "created"). Valid values: created, sent, delivered, completed, declined, voided. Default includes all.',
    }),
    limit: Flags.integer({
      description: 'Max envelopes to return (count)',
      default: 100,
    }),
    'start-position': Flags.integer({
      description: 'Pagination offset (start_position)',
      default: 0,
    }),
    'include-deleted': Flags.boolean({
      description: 'Include envelopes in the recyclebin folder (deleted envelopes). Default excludes them.',
      default: false,
    }),
    'folder-ids': Flags.string({
      description: 'Comma-separated folder IDs to include (e.g. sentitems,draft). Overrides --include-deleted.',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(EnvelopesList)

    try {
      const client = await this.getConnection()
      const fromDate = flags['from-date']
        || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

      // DocuSign's list combines `status` and `folder_ids` poorly when both
      // are comma-lists — the intersection only honors a single status.
      // To work around that, we prefer the folder-based filter: passing
      // folder_ids alone returns every envelope in those folders across
      // all statuses. Use status only when the caller explicitly asks.
      //
      // Active envelopes live in sentitems, inbox, or draft; recyclebin
      // holds deleted envelopes and is excluded by default.
      const NON_TRASH_FOLDERS = 'sentitems,inbox,draft'
      const folderIds = flags['folder-ids']
        ?? (flags['include-deleted'] ? undefined : NON_TRASH_FOLDERS)

      // If the caller passed --status explicitly, honor it (understanding
      // the single-status interaction quirk). Otherwise omit status and
      // let folder_ids widen the list to every active envelope.
      const status = flags.status
        ?? (folderIds ? undefined : 'created,sent,delivered,completed,declined,voided')

      const response = await client.listEnvelopes({
        fromDate,
        status,
        count: flags.limit,
        startPosition: flags['start-position'],
        folderIds,
      })

      const returned = response.envelopes?.length ?? 0
      const hasMore = Boolean(response.nextUri)
      const nextStart = (flags['start-position'] ?? 0) + returned
      // Reproduce the original filter flags so the next call resolves
      // to the same scope; only --start-position advances. We pass
      // explicit fromDate (resolved above) so the default 30-day window
      // doesn't shift between calls.
      const cmdParts = [
        '$BIN docusign envelopes list',
        `--from-date ${fromDate}`,
        `--limit ${flags.limit}`,
        `--start-position ${nextStart}`,
      ]
      if (flags.status) cmdParts.push(`--status "${flags.status}"`)
      if (flags['folder-ids']) cmdParts.push(`--folder-ids "${flags['folder-ids']}"`)
      if (flags['include-deleted']) cmdParts.push('--include-deleted')
      const nextCommand = hasMore ? cmdParts.join(' ') : null

      await this.outputResult(response, this.buildContext({
        returned,
        total: response.totalSetSize ? parseInt(response.totalSetSize, 10) : null,
        hasMore,
        nextCommand,
        relatedCommands: [
          '$BIN docusign envelopes get --envelope-id <id> --json',
          '$BIN docusign envelopes download --envelope-id <id> --output ./signed.pdf',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
