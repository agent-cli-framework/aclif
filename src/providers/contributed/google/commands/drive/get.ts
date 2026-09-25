// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import {FILE_FIELDS, FILE_SHAPE_FIELDS, toDriveFile, type DriveApiFile} from '../../drive-files.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/** Metadata for one Drive file: the fields `drive list` returns, plus `trashed`. */
export default class DriveGet extends GoogleBaseCommand {
  static override description = 'Get the metadata of one Google Drive file'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Get a file\'s metadata',
      command: '$BIN google drive get --file-id 1XyZ --json',
      responseShape: {id: '1XyZ', name: 'complaint.pdf', mimeType: 'application/pdf', modifiedTime: '2026-09-01T12:00:00.000Z', size: 48213, md5Checksum: '9e107d9d372bb6826bd81d3542a419d6', parents: ['1AbCdEfGhIjK'], webViewLink: 'https://drive.google.com/file/d/1XyZ/view', trashed: false},
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'File metadata',
    fields: {
      ...FILE_SHAPE_FIELDS,
      trashed: {type: 'boolean', description: 'Whether the file is in the trash'},
    },
    example: {id: '1XyZ', name: 'complaint.pdf', mimeType: 'application/pdf', modifiedTime: '2026-09-01T12:00:00.000Z', size: 48213, parents: ['1AbCdEfGhIjK'], webViewLink: 'https://drive.google.com/file/d/1XyZ/view', trashed: false},
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

  static override flags = {
    ...GoogleBaseCommand.baseFlags,
    'file-id': Flags.string({
      description: 'Drive file id',
      required: true,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DriveGet)

    try {
      const conn = await this.getConnection()
      const file = await conn.driveGet<DriveApiFile>(`/files/${encodeURIComponent(flags['file-id'])}`, {
        fields: FILE_FIELDS,
        supportsAllDrives: 'true',
      })

      await this.outputResult({...toDriveFile(file), trashed: file.trashed ?? false}, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google drive view-url --file-id ${file.id}`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
