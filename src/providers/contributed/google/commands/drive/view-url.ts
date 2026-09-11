// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/**
 * Build the deterministic Google Drive web-UI URL for a file.
 *
 * No API call — `https://drive.google.com/file/d/<id>/view` works for
 * both binary uploads and Google Docs / Sheets / Slides; Drive resolves
 * the right viewer at click time. Mirrors `docusign envelopes view-url`
 * and `salesforce files view-url`.
 */
export default class DriveViewUrl extends GoogleBaseCommand {
  static override description =
    'Build the Google Drive web-UI URL for a file (deterministic — no API call)'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Get a click-through URL for a Drive file',
      command: '$BIN google drive view-url --file-id 1AbCdEfGhIjK --json',
      responseShape: {
        fileId: '1AbCdEfGhIjK',
        url: 'https://drive.google.com/file/d/1AbCdEfGhIjK/view',
      },
    },
  ]

  static override responseShape: ResponseShape = {
    description:
      'Deterministic web-UI URL that opens the Drive file in the user\'s ' +
      'Google session. No API call is made — the URL is formatted from ' +
      'the supplied file id. The user must have read access in their own ' +
      'Drive for the link to render content.',
    fields: {
      fileId: {type: 'string', description: 'Echo of the Drive file id'},
      url: {type: 'string', description: 'drive.google.com view URL'},
    },
    example: {
      fileId: '1AbCdEfGhIjK',
      url: 'https://drive.google.com/file/d/1AbCdEfGhIjK/view',
    },
  }

  static override flagCategories: FlagCategorization = {
    'file-id': ['filtering'],
    json: ['output'],
    'service-account-key': ['auth'],
    'delegated-user': ['auth'],
    'gw-client-id': ['auth'],
    'gw-client-secret': ['auth'],
    'refresh-token': ['auth'],
    'access-token': ['auth'],
    'service-account': ['auth'],
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 0,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override flags = {
    ...GoogleBaseCommand.baseFlags,
    'file-id': Flags.string({
      description: 'Drive file id',
      required: true,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DriveViewUrl)

    try {
      const fileId = flags['file-id']
      const url = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`

      await this.outputResult(
        {fileId, url},
        this.buildContext({returned: 1}),
      )
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
