// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import {FILE_FIELDS, FILE_SHAPE_FIELDS, FOLDER_MIME, toDriveFile, type DriveApiFile, type DriveFile} from '../../drive-files.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/** Drive's maximum page size for files.list. */
const MAX_PAGE_SIZE = 1000

/**
 * Where a walk stopped: the folders still to list (id and path below the
 * root, current folder first) and Drive's page token inside the first one.
 * Serialized as the opaque --page-token.
 */
interface WalkState {
  queue: Array<[string, string]>
  pageToken?: string
}

function encodeState(state: WalkState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeState(token: string): WalkState {
  let state: WalkState
  try {
    state = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as WalkState
  } catch {
    throw new Error('Invalid --page-token: pass the value from a previous _context.pagination.nextCommand unchanged')
  }
  if (!Array.isArray(state.queue)) {
    throw new Error('Invalid --page-token: pass the value from a previous _context.pagination.nextCommand unchanged')
  }
  return state
}

/**
 * List the files in a Drive folder, optionally walking its subfolders.
 *
 * Folders are walked breadth-first and never listed themselves. Each
 * file carries `folderPath`, its subfolder path below --folder-id ("" for
 * files directly in it). Each Drive request asks for no more items than
 * the rows still wanted, so a page ends on a Drive page boundary and the
 * --page-token (the pending folder queue plus Drive's own page token)
 * resumes exactly where the page stopped. Trashed files are skipped.
 */
export default class DriveList extends GoogleBaseCommand {
  static override description = 'List the files in a Google Drive folder, optionally including its subfolders'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 1, // one per folder page walked
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'List the files directly in a folder',
      command: '$BIN google drive list --folder-id 1AbCdEfGhIjK --json',
      responseShape: {
        files: [{id: '1XyZ', name: 'complaint.pdf', mimeType: 'application/pdf', modifiedTime: '2026-09-01T12:00:00.000Z', size: 48213, md5Checksum: '9e107d9d372bb6826bd81d3542a419d6', parents: ['1AbCdEfGhIjK'], webViewLink: 'https://drive.google.com/file/d/1XyZ/view', folderPath: ''}],
      },
    },
    {
      description: 'List every file below a folder, with each file\'s subfolder path',
      command: '$BIN google drive list --folder-id 1AbCdEfGhIjK --recursive --limit 1000 --json',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Files in the folder (and its subfolders with --recursive); folders are not listed',
    fields: {
      files: {type: 'array', description: 'Files, each with the fields below'},
      ...FILE_SHAPE_FIELDS,
      folderPath: {type: 'string', description: 'Subfolder path below --folder-id, "/"-separated; "" for files directly in it'},
    },
    example: {
      files: [{id: '1XyZ', name: 'production-001.pdf', mimeType: 'application/pdf', modifiedTime: '2026-09-01T12:00:00.000Z', size: 48213, parents: ['1FoLdEr'], webViewLink: 'https://drive.google.com/file/d/1XyZ/view', folderPath: 'productions/2026-09'}],
    },
  }

  static override flagCategories: FlagCategorization = {
    'folder-id': ['filtering'],
    recursive: ['filtering'],
    limit: ['pagination'],
    'page-token': ['pagination'],
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
    'folder-id': Flags.string({
      description: 'Drive folder id to list',
      required: true,
    }),
    recursive: Flags.boolean({
      description: 'Walk subfolders and list their files too',
      default: false,
    }),
    limit: Flags.integer({
      description: 'Maximum number of files to return in this page',
      default: 100,
      min: 1,
    }),
    'page-token': Flags.string({
      description:
        'Opaque pageToken from a prior call\'s _context.pagination.nextCommand. ' +
        'Pass through verbatim to fetch the next page.',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DriveList)

    if (this.isDryRun(flags, {folderId: flags['folder-id'], recursive: flags.recursive, limit: flags.limit})) return

    try {
      const state: WalkState = flags['page-token']
        ? decodeState(flags['page-token'])
        : {queue: [[flags['folder-id'], '']]}

      const conn = await this.getConnection()
      const files: Array<DriveFile & {folderPath: string}> = []

      while (state.queue.length > 0 && files.length < flags.limit) {
        const [folderId, folderPath] = state.queue[0]
        const params: Record<string, string> = {
          q: `'${folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and trashed = false`,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: String(Math.min(MAX_PAGE_SIZE, flags.limit - files.length)),
          orderBy: 'folder,name',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        }
        if (state.pageToken) params.pageToken = state.pageToken

        const page = await conn.driveGet<{files?: DriveApiFile[]; nextPageToken?: string}>('/files', params)
        for (const file of page.files ?? []) {
          if (file.mimeType === FOLDER_MIME) {
            if (flags.recursive && file.id) {
              state.queue.push([file.id, folderPath ? `${folderPath}/${file.name}` : String(file.name)])
            }
            continue
          }
          files.push({...toDriveFile(file), folderPath})
        }

        if (page.nextPageToken) {
          state.pageToken = page.nextPageToken
        } else {
          state.queue.shift()
          state.pageToken = undefined
        }
      }

      const hasMore = state.queue.length > 0
      const nextCommand = hasMore
        ? `$BIN google drive list --folder-id "${flags['folder-id']}"` +
          (flags.recursive ? ' --recursive' : '') +
          ` --limit ${flags.limit} --page-token "${encodeState(state)}"`
        : null

      await this.outputResult({files}, this.buildContext({
        returned: files.length,
        hasMore,
        nextCommand,
        relatedCommands: files.length > 0
          ? [`$BIN google drive get --file-id ${files[0].id}`]
          : [],
        refinements: flags.recursive ? [] : ['Add --recursive to include files in subfolders'],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
