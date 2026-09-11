// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class GmailGet extends GoogleBaseCommand {
  static override description = 'Get a single Gmail message by ID'

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
      description: 'Get a message by ID',
      command: '$BIN google gmail get --message-id 18f0abc123',
      responseShape: {id: '18f0abc123', threadId: '18f0abc123', from: 'sender@example.com', subject: 'Hello', body: 'Message body...', attachments: []},
    },
    {
      description: 'Get message metadata only (no body, no attachments)',
      command: '$BIN google gmail get --message-id 18f0abc123 --metadata-only',
    },
    {
      description: 'Get a message with attachments — pair with `gmail get-attachment` to fetch bytes',
      command: '$BIN google gmail get --message-id 18f0abc123 --json',
      responseShape: {id: '18f0abc123', body: 'Please find resume attached', attachments: [{id: 'ANGjdJ...', filename: 'resume.pdf', mime_type: 'application/pdf', size: 84012}]},
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Full Gmail message with headers, body, and attachment metadata',
    fields: {
      id: {type: 'string', description: 'Message ID'},
      threadId: {type: 'string', description: 'Thread ID'},
      from: {type: 'string', description: 'Sender email'},
      to: {type: 'string', description: 'Recipient email(s)'},
      subject: {type: 'string', description: 'Message subject'},
      date: {type: 'string', description: 'Message date'},
      body: {type: 'string', nullable: true, description: 'Message body text (plain text preferred)'},
      labelIds: {type: 'array', description: 'Labels applied to the message'},
      attachments: {type: 'array', description: 'Attachment metadata — {id, filename, mime_type, size} per part with body.attachmentId. Use `gmail get-attachment` to fetch bytes.'},
    },
    example: {id: '18f0abc', threadId: '18f0abc', from: 'sender@example.com', to: 'me@example.com', subject: 'Hello', date: '2026-04-09T14:30:00Z', body: 'Hello there!', labelIds: ['INBOX', 'UNREAD'], attachments: [{id: 'ANGjdJ...', filename: 'resume.pdf', mime_type: 'application/pdf', size: 84012}]},
  }

  static override flagCategories: FlagCategorization = {
    'message-id': ['filtering'],
    'metadata-only': ['output'],
    fields: ['output'],
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
    'message-id': Flags.string({
      description: 'Gmail message ID',
      required: true,
    }),
    'metadata-only': Flags.boolean({
      description: 'Return only headers, no body, no attachments',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(GmailGet)

    if (this.isDryRun(flags, {messageId: flags['message-id']})) return

    try {
      const conn = await this.getConnection()
      const gmailProxy = conn.gmail()
      const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail

      const format = flags['metadata-only'] ? 'metadata' : 'full'
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: flags['message-id'],
        format,
        metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Cc', 'Bcc', 'In-Reply-To', 'References'],
      })

      const headers = response.data.payload?.headers || []
      const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

      const result: Record<string, unknown> = {
        id: response.data.id,
        threadId: response.data.threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        cc: getHeader('Cc') || undefined,
        bcc: getHeader('Bcc') || undefined,
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        snippet: response.data.snippet,
        labelIds: response.data.labelIds,
        inReplyTo: getHeader('In-Reply-To') || undefined,
        references: getHeader('References') || undefined,
      }

      if (!flags['metadata-only']) {
        const walked = walkPayload(response.data.payload)
        result.body = walked.body
        result.attachments = walked.attachments
      }

      await this.outputResult(result, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google gmail query --query "thread:${response.data.threadId}" --json`,
          `$BIN google gmail reply --thread-id ${response.data.threadId} --message-id ${response.data.id} --body "..." --json`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}

/**
 * Metadata for one Gmail attachment part — enough for a caller to pick the
 * one they want and fetch the bytes via `gmail get-attachment`. The body
 * itself stays in Gmail's storage; this command never streams attachment
 * bytes (use `get-attachment` for that).
 */
export interface GmailAttachmentMeta {
  id: string
  /** Tolerance alias for `id` (#3): snippet authors sometimes read `attachmentId`. */
  attachmentId: string
  filename: string
  mime_type: string
  size: number
}

/**
 * Walk a Gmail message payload once and return both the text body and a
 * flat list of every attachment part's metadata. Body picking prefers
 * text/plain over text/html (matching Gmail web client behaviour);
 * attachments are any part with a non-empty `body.attachmentId`,
 * including ones nested inside `multipart/related` (inline images get
 * surfaced; callers can filter by mime_type if they only want
 * resume-shaped types).
 *
 * Exported so `gmail get-attachment` can reuse it to resolve a flag
 * `--attachment-id` to its content_type + filename without duplicating
 * the walk.
 */
export function walkPayload(payload: unknown): {body: string; attachments: GmailAttachmentMeta[]} {
  const attachments: GmailAttachmentMeta[] = []
  const body = walkForBody(payload, attachments)
  return {body, attachments}
}

function walkForBody(payload: unknown, attachments: GmailAttachmentMeta[]): string {
  if (!payload || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>

  // Single-part message: capture body if it's text, capture attachment
  // metadata if the body carries an attachmentId.
  if (p.body && typeof p.body === 'object') {
    const body = p.body as {data?: string; size?: number; attachmentId?: string}
    if (body.attachmentId) {
      attachments.push({
        id: body.attachmentId,
        // Tolerance alias (#3): emit both `id` and `attachmentId` so whichever
        // key the composer reaches for resolves instead of reading empty.
        attachmentId: body.attachmentId,
        filename: (p.filename as string) || '',
        mime_type: (p.mimeType as string) || 'application/octet-stream',
        size: body.size || 0,
      })
    } else if (body.data && body.size && body.size > 0) {
      const mimeType = (p.mimeType as string) || ''
      if (mimeType === 'text/plain' || mimeType === 'text/html') {
        return base64urlDecode(body.data)
      }
    }
  }

  // Multipart: find the best body candidate AND recurse for attachments.
  if (Array.isArray(p.parts)) {
    const parts = p.parts as Array<Record<string, unknown>>

    // Always recurse into every part so attachments at any depth land
    // in the flat list. Body resolution still prefers text/plain over
    // text/html over deeper recursion.
    let plain = ''
    let html = ''
    let nested = ''

    for (const part of parts) {
      const partBody = part.body as {data?: string; size?: number; attachmentId?: string} | undefined
      if (partBody?.attachmentId) {
        attachments.push({
          id: partBody.attachmentId,
          // Tolerance alias (#3): emit both `id` and `attachmentId`.
          attachmentId: partBody.attachmentId,
          filename: (part.filename as string) || '',
          mime_type: (part.mimeType as string) || 'application/octet-stream',
          size: partBody.size || 0,
        })
        continue
      }
      if (part.mimeType === 'text/plain' && partBody?.data && !plain) {
        plain = base64urlDecode(partBody.data)
      } else if (part.mimeType === 'text/html' && partBody?.data && !html) {
        html = base64urlDecode(partBody.data)
      } else if (Array.isArray(part.parts)) {
        // Recurse for attachments AND, if we haven't found a body yet,
        // for nested text bodies (multipart/alternative inside
        // multipart/mixed).
        const sub = walkForBody(part, attachments)
        if (sub && !nested) nested = sub
      }
    }

    return plain || html || nested
  }

  return ''
}

function base64urlDecode(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64').toString('utf-8')
}
