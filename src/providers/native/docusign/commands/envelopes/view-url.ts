// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {DocuSignBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class EnvelopesViewUrl extends DocuSignBaseCommand {
  static override description =
    'Build the apps.docusign.com web-UI URL for an envelope (deterministic — no API call)'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Get a click-through URL for an envelope in the DocuSign web UI',
      command: '$BIN docusign envelopes view-url --envelope-id abc-123-def --json',
      responseShape: {
        envelopeId: 'abc-123-def',
        url: 'https://apps-d.docusign.com/send/documents/details/abc-123-def',
      },
    },
  ]

  static override responseShape: ResponseShape = {
    description:
      'Deterministic web-UI URL that opens the envelope details page in ' +
      'DocuSign. The user must have their own DocuSign account that can ' +
      'access the envelope; they land in their own session, with the ' +
      'signed PDF rendered inline and native download buttons available. ' +
      'No DocuSign API call is made — the URL is computed from the ' +
      'connection baseUri and the envelope id. Permanent and not ' +
      'single-use.',
    fields: {
      envelopeId: {type: 'string', description: 'Echo of the envelope GUID'},
      url: {
        type: 'string',
        description:
          'apps.docusign.com (production) or apps-d.docusign.com (demo) URL.',
      },
    },
    example: {
      envelopeId: 'xyz',
      url: 'https://apps-d.docusign.com/send/documents/details/xyz',
    },
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
    // Pure URL formatting — no DocuSign API call. Still need a
    // connection to resolve the apps host for the right environment
    // (demo vs prod).
    apiCallsConsumed: 0,
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
    const {flags} = await this.parse(EnvelopesViewUrl)

    try {
      const client = await this.getConnection()
      const {url} = client.getEnvelopeAppsUrl(flags['envelope-id'])

      await this.outputResult(
        {
          envelopeId: flags['envelope-id'],
          url,
        },
        this.buildContext({returned: 1}),
      )
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
