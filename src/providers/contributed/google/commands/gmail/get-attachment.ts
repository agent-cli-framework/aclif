// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {writeFile} from 'node:fs/promises'

import {Flags} from '@oclif/core'

import {GoogleBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/**
 * Fetch a single attachment's bytes from a Gmail message.
 *
 * The Gmail API splits attachment access into two calls: `messages.get`
 * surfaces each part's `attachmentId` + filename + mimeType, then
 * `messages.attachments.get` returns the bytes for one of those ids.
 * The bytes-only response does NOT carry the filename or MIME type —
 * those live on the parent message's part list.
 *
 * We deliberately DON'T do a second messages.get round-trip here:
 * Gmail's attachment IDs are documented as "valid for at least a
 * week" rather than session-stable, and in practice a re-fetch of the
 * same message can return DIFFERENT attachment IDs than the first
 * fetch returned. So a re-walk to resolve the same id back to its
 * filename+mime_type fails intermittently. The caller already has
 * filename + mime_type from its initial `gmail get` and can pass them
 * through as optional flags; we surface them on the response if
 * provided, or leave them empty.
 *
 * Output mirrors `docusign envelopes download`: when `--output` is set
 * the bytes are written to disk and the result is metadata only; without
 * `--output` the bytes come back base64-encoded in the JSON payload so
 * a snippet caller can decode + extract inline.
 */
export default class GmailGetAttachment extends GoogleBaseCommand {
  static override description = 'Fetch one attachment from a Gmail message by attachment id'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 2,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Fetch an attachment as base64 (for in-snippet processing)',
      command: '$BIN google gmail get-attachment --message-id 18f0abc --attachment-id ANGjdJ... --json',
      responseShape: {message_id: '18f0abc', attachment_id: 'ANGjdJ...', filename: 'resume.pdf', content_type: 'application/pdf', size: 84012, base64: 'JVBERi0xLjQK...'},
    },
    {
      description: 'Save an attachment to disk',
      command: '$BIN google gmail get-attachment --message-id 18f0abc --attachment-id ANGjdJ... --output ./resume.pdf',
      responseShape: {message_id: '18f0abc', attachment_id: 'ANGjdJ...', filename: 'resume.pdf', content_type: 'application/pdf', size: 84012, output: './resume.pdf'},
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Attachment metadata + bytes (base64 in JSON, or written to --output)',
    fields: {
      message_id: {type: 'string', description: 'Parent message id'},
      attachment_id: {type: 'string', description: 'Gmail attachment id'},
      filename: {type: 'string', description: 'Original filename from the part headers'},
      content_type: {type: 'string', description: 'MIME type from the part headers'},
      size: {type: 'integer', description: 'Byte length of the decoded payload'},
      base64: {type: 'string', nullable: true, description: 'Base64-encoded bytes (only when --output is omitted)'},
      output: {type: 'string', nullable: true, description: 'Path written to (only when --output is provided)'},
    },
    example: {message_id: '18f0abc', attachment_id: 'ANGjdJ...', filename: 'resume.pdf', content_type: 'application/pdf', size: 84012, base64: 'JVBERi0xLjQK...'},
  }

  static override flagCategories: FlagCategorization = {
    'message-id': ['filtering'],
    'attachment-id': ['filtering'],
    filename: ['output'],
    'content-type': ['output'],
    output: ['output'],
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
      description: 'Gmail message id that owns the attachment',
      required: true,
    }),
    'attachment-id': Flags.string({
      description: 'Attachment id from the message (see `gmail get` `attachments[].id`)',
      required: true,
    }),
    filename: Flags.string({
      description:
        'Original filename from the parent message part. Echoed on the response — the API does not return it from attachments.get. Pass through from `gmail get` attachments[].filename.',
    }),
    'content-type': Flags.string({
      description:
        'MIME type from the parent message part. Echoed on the response — the API does not return it from attachments.get. Pass through from `gmail get` attachments[].mime_type.',
    }),
    output: Flags.string({
      description: 'Path to write the decoded bytes to. Omit to receive base64 in the JSON result.',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(GmailGetAttachment)

    if (this.isDryRun(flags, {messageId: flags['message-id'], attachmentId: flags['attachment-id']})) return

    try {
      const conn = await this.getConnection()
      const gmailProxy = conn.gmail()
      const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail

      // Call attachments.get directly — `data` comes back base64url.
      // We deliberately don't re-walk the parent message to validate
      // the id (Gmail's attachment IDs are not guaranteed session-
      // stable across calls, so a re-walk can fail spuriously). If
      // the id is genuinely bogus, the API will return its own
      // NOT_FOUND which formatError surfaces unchanged.
      const attResp = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: flags['message-id'],
        id: flags['attachment-id'],
      })
      const data = attResp.data.data || ''
      const bytes = base64urlToBuffer(data)

      const filename = flags.filename || ''
      const contentType = flags['content-type'] || ''

      let result: Record<string, unknown>
      if (flags.output) {
        await writeFile(flags.output, bytes)
        result = {
          message_id: flags['message-id'],
          attachment_id: flags['attachment-id'],
          filename,
          content_type: contentType,
          size: bytes.length,
          output: flags.output,
        }
      } else {
        const b64 = bytes.toString('base64')
        result = {
          message_id: flags['message-id'],
          attachment_id: flags['attachment-id'],
          filename,
          content_type: contentType,
          size: bytes.length,
          output: null,
          base64: b64,
          // Tolerance alias (#3): snippet authors authored from natural
          // language sometimes read `data` instead of `base64`. Emit both so
          // either key resolves rather than silently reading empty.
          data: b64,
        }
      }

      await this.outputResult(result, this.buildContext({returned: 1}))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}

function base64urlToBuffer(data: string): Buffer {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64')
}
