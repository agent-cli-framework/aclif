// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {DocuSignBaseCommand} from '../../base.js'
import {markdownToEnvelopeDoc} from '../../markdown.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class EnvelopesCreate extends DocuSignBaseCommand {
  static override description = 'Create a DocuSign envelope from a local markdown file (converted inline to HTML)'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Create a draft envelope (no emails sent)',
      command: '$BIN docusign envelopes create --file ./nda.md --subject "Please sign NDA" --signer-email alice@example.com --signer-name "Alice Example" --status created --json',
      responseShape: {envelopeId: 'abc-123', status: 'created', statusDateTime: '2025-10-01T12:00:00Z'},
    },
    {
      description: 'Send envelope immediately (emails the signer)',
      command: '$BIN docusign envelopes create --file ./msa.md --subject "MSA" --signer-email signer@example.com --signer-name "Signer Example" --status sent --confirm --json',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Envelope creation result',
    fields: {
      envelopeId: {type: 'string', description: 'Server-assigned envelope GUID'},
      status: {type: 'string', description: 'created (draft) or sent'},
      statusDateTime: {type: 'string', nullable: true},
      uri: {type: 'string', nullable: true, description: 'Relative API URI for the new envelope'},
    },
    example: {envelopeId: 'abc-123', status: 'created'},
  }

  static override flagCategories: FlagCategorization = {
    file: ['filtering'],
    subject: ['filtering'],
    message: ['filtering'],
    'signer-email': ['filtering'],
    'signer-name': ['filtering'],
    status: ['filtering'],
    confirm: ['output'],
    json: ['output'],
    'integration-key': ['auth'],
    'user-id': ['auth'],
    'account-id': ['auth'],
    'private-key': ['auth'],
    'service-account': ['auth'],
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false, // becomes true when status=sent
    prerequisites: [],
  }

  static override flags = {
    ...DocuSignBaseCommand.baseFlags,
    file: Flags.string({
      description: 'Path to a markdown file to sign',
      required: true,
    }),
    subject: Flags.string({
      description: 'Envelope email subject',
      required: true,
    }),
    'signer-email': Flags.string({
      description: 'Signer email address',
      required: true,
    }),
    'signer-name': Flags.string({
      description: 'Signer display name',
      required: true,
    }),
    status: Flags.string({
      description: 'Envelope status on creation: "created" (draft, no emails) or "sent" (dispatches immediately)',
      options: ['created', 'sent'],
      default: 'created',
    }),
    message: Flags.string({
      description: 'Optional email body sent to the signer',
    }),
    confirm: Flags.boolean({
      description: 'Confirm dispatch when --status sent (bypass safety prompt)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(EnvelopesCreate)
    if (this.isDryRun(flags, {file: flags.file, subject: flags.subject, signerEmail: flags['signer-email'], signerName: flags['signer-name'], status: flags.status})) return

    if (flags.status === 'sent' && !flags.confirm) {
      this.outputError({
        code: 'CONFIRMATION_REQUIRED',
        message: '--status sent will email the signer. Re-run with --confirm to dispatch, or use --status created for a draft.',
      })
      return
    }

    try {
      const client = await this.getConnection()
      const document = await markdownToEnvelopeDoc(flags.file)

      const request = {
        emailSubject: flags.subject,
        emailBlurb: flags.message,
        status: flags.status as 'created' | 'sent',
        documents: [document],
        recipients: {
          signers: [{
            email: flags['signer-email'],
            name: flags['signer-name'],
            recipientId: '1',
            routingOrder: '1',
            tabs: {
              signHereTabs: [{
                anchorString: '/sn1/',
                anchorUnits: 'pixels',
                anchorXOffset: '0',
                anchorYOffset: '0',
              }],
            },
          }],
        },
      }

      const result = await client.createEnvelope(request)

      await this.outputResult(result, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN docusign envelopes get --envelope-id ${result.envelopeId} --json`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
