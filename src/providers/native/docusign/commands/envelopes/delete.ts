// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {DocuSignBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/**
 * "Delete" on DocuSign means moving the envelope to the recyclebin folder.
 * It works for any envelope status; completed envelopes stay completed but
 * are filed away, drafts disappear from the Drafts view. Reversible —
 * envelopes can be moved back out of recyclebin.
 */
export default class EnvelopesDelete extends DocuSignBaseCommand {
  static override description = 'Move a DocuSign envelope to the recyclebin folder (DocuSign\'s delete equivalent)'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Delete a draft envelope',
      command: '$BIN docusign envelopes delete --envelope-id abc-123 --confirm --json',
      responseShape: {envelopeId: 'abc-123', folderId: 'recyclebin', deleted: true},
    },
    {
      description: 'Move an envelope to a specific folder (not recyclebin)',
      command: '$BIN docusign envelopes delete --envelope-id abc-123 --folder-id draft --confirm --json',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Move result',
    fields: {
      envelopeId: {type: 'string', description: 'Envelope GUID that was moved'},
      folderId: {type: 'string', description: 'Destination folder (default recyclebin)'},
      deleted: {type: 'boolean', description: 'true when the destination was recyclebin'},
    },
    example: {envelopeId: 'abc-123', folderId: 'recyclebin', deleted: true},
  }

  static override flagCategories: FlagCategorization = {
    'envelope-id': ['filtering'],
    'folder-id': ['filtering'],
    confirm: ['output'],
    json: ['output'],
    'integration-key': ['auth'],
    'user-id': ['auth'],
    'account-id': ['auth'],
    'private-key': ['auth'],
    'service-account': ['auth'],
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'delete',
    idempotent: true,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: true,
    prerequisites: [],
  }

  static override flags = {
    ...DocuSignBaseCommand.baseFlags,
    'envelope-id': Flags.string({
      description: 'Envelope GUID to move',
      required: true,
    }),
    'folder-id': Flags.string({
      description: 'Destination folder (default: recyclebin, which is DocuSign\'s delete behaviour)',
      default: 'recyclebin',
    }),
    confirm: Flags.boolean({
      description: 'Required to execute the move',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(EnvelopesDelete)
    if (this.isDryRun(flags, {envelopeId: flags['envelope-id'], folderId: flags['folder-id']})) return

    if (!flags.confirm) {
      this.outputError({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Re-run with --confirm to move the envelope (reversible: envelope can be moved back out of recyclebin).',
      })
      return
    }

    try {
      const client = await this.getConnection()
      await client.moveEnvelopeToFolder(flags['envelope-id'], flags['folder-id'])

      await this.outputResult({
        envelopeId: flags['envelope-id'],
        folderId: flags['folder-id'],
        deleted: flags['folder-id'] === 'recyclebin',
      }, this.buildContext({returned: 1}))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
