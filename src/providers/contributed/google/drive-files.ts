// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Drive file metadata shared by `drive list` and `drive get`.
 */

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Drive v3 `fields` selector for one file. */
export const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,md5Checksum,parents,webViewLink,trashed'

/** A file as the Drive v3 API returns it; `size` is an int64 encoded as a string. */
export interface DriveApiFile {
  id?: string
  name?: string
  mimeType?: string
  modifiedTime?: string
  size?: string
  md5Checksum?: string
  parents?: string[]
  webViewLink?: string
  trashed?: boolean
}

export interface DriveFile {
  id?: string
  name?: string
  mimeType?: string
  modifiedTime?: string
  /** Bytes. Absent for Google Docs, Sheets, and Slides, which have no stored size. */
  size?: number
  /** Absent for Google-native files, which Drive does not checksum. */
  md5Checksum?: string
  parents?: string[]
  webViewLink?: string
}

export function toDriveFile(file: DriveApiFile): DriveFile {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    size: file.size === undefined ? undefined : Number(file.size),
    md5Checksum: file.md5Checksum,
    parents: file.parents,
    webViewLink: file.webViewLink,
  }
}

/** Response fields common to both commands. */
export const FILE_SHAPE_FIELDS = {
  id: {type: 'string', description: 'Drive file id'},
  name: {type: 'string', description: 'File name'},
  mimeType: {type: 'string', description: 'MIME type; Google Docs, Sheets, and Slides use application/vnd.google-apps.*'},
  modifiedTime: {type: 'string', description: 'Last modified time (RFC 3339)'},
  size: {type: 'number', description: 'Size in bytes; absent for Google-native files'},
  md5Checksum: {type: 'string', description: 'MD5 of the content; absent for Google-native files'},
  parents: {type: 'array', description: 'Ids of the folders that contain the file'},
  webViewLink: {type: 'string', description: 'Link that opens the file in Drive'},
} as const
