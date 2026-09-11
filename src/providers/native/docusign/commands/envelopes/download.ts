// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {writeFile} from 'node:fs/promises'

import {Flags} from '@oclif/core'

import {DocuSignBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class EnvelopesDownload extends DocuSignBaseCommand {
  static override description = 'Download a document from a DocuSign envelope'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Download the combined signed PDF',
      command: '$BIN docusign envelopes download --envelope-id abc-123 --output ./signed.pdf',
      responseShape: {envelopeId: 'abc-123', documentId: 'combined', bytes: 12345, output: './signed.pdf'},
    },
    {
      description: 'Download the Certificate of Completion',
      command: '$BIN docusign envelopes download --envelope-id abc-123 --document-id certificate --output ./cert.pdf',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Download result metadata (bytes written to --output)',
    fields: {
      envelopeId: {type: 'string'},
      documentId: {type: 'string'},
      bytes: {type: 'integer', description: 'Size of the downloaded payload'},
      output: {type: 'string', nullable: true, description: 'Path written to, or null if stdout'},
    },
    example: {envelopeId: 'abc-123', documentId: 'combined', bytes: 12345, output: './signed.pdf'},
  }

  static override flagCategories: FlagCategorization = {
    'envelope-id': ['filtering'],
    'document-id': ['filtering'],
    output: ['output'],
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
    'document-id': Flags.string({
      description: 'Document ID — "combined" for merged signed PDF, "certificate" for CoC, or numeric doc id',
      default: 'combined',
    }),
    output: Flags.string({
      description: 'Path to write the downloaded PDF. Omit to emit base64 in the JSON result.',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(EnvelopesDownload)

    try {
      const client = await this.getConnection()
      const bytes = await client.downloadDocument(flags['envelope-id'], flags['document-id'])

      let result: Record<string, unknown>
      if (flags.output) {
        await writeFile(flags.output, bytes)
        result = {
          envelopeId: flags['envelope-id'],
          documentId: flags['document-id'],
          bytes: bytes.length,
          output: flags.output,
        }
      } else {
        result = {
          envelopeId: flags['envelope-id'],
          documentId: flags['document-id'],
          bytes: bytes.length,
          output: null,
          base64: Buffer.from(bytes).toString('base64'),
        }
      }

      await this.outputResult(result, this.buildContext({returned: 1}))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
