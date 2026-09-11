// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {DocuSignBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class EnvelopesGet extends DocuSignBaseCommand {
  static override description = 'Get a DocuSign envelope by ID'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Get envelope status',
      command: '$BIN docusign envelopes get --envelope-id abc-123-def --json',
      responseShape: {envelopeId: 'abc-123-def', status: 'completed', emailSubject: 'NDA', completedDateTime: '2025-10-01T12:00:00Z'},
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Single envelope record',
    fields: {
      envelopeId: {type: 'string', description: 'Unique envelope GUID'},
      status: {type: 'string', description: 'created | sent | delivered | completed | declined | voided'},
      emailSubject: {type: 'string', nullable: true},
      sentDateTime: {type: 'string', nullable: true},
      completedDateTime: {type: 'string', nullable: true},
      lastModifiedDateTime: {type: 'string', nullable: true},
    },
    example: {envelopeId: 'xyz', status: 'sent', emailSubject: 'NDA'},
  }

  static override flagCategories: FlagCategorization = {
    'envelope-id': ['filtering'],
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
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override flags = {
    ...DocuSignBaseCommand.baseFlags,
    'envelope-id': Flags.string({
      description: 'Envelope GUID',
      required: true,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(EnvelopesGet)

    try {
      const client = await this.getConnection()
      const envelope = await client.getEnvelope(flags['envelope-id'])

      await this.outputResult(envelope, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN docusign envelopes download --envelope-id ${flags['envelope-id']} --output ./signed.pdf`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
