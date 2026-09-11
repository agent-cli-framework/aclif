// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {basename, extname} from 'node:path'

import {GoogleBaseCommand} from '../../base.js'
import {buildRawMessage, type Attachment} from '../../message-builder.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/**
 * Insert an RFC 2822 message into the user's mailbox WITHOUT sending.
 *
 * Wraps the Gmail API's `users.messages.import` endpoint. Unlike
 * `gmail send`, no SMTP delivery occurs — the message is written
 * directly to the mailbox as if it had been received. The `From:`,
 * `Date:`, and `Message-ID:` headers can be set to arbitrary values,
 * which makes this the right tool for fixture / seed data and for
 * mirroring messages from external systems.
 *
 * Use cases:
 *   - Seed scripts that need realistic email volume without paying
 *     for outbound deliverability or risking sender-reputation damage
 *     from bounces (`@example.com` recipients all bounce).
 *   - Backfilling historical messages whose original Date header
 *     should be preserved.
 *   - Migrating mail from an archive into a Gmail mailbox.
 *
 * The mailbox-side effect mirrors `gmail send` (the message lands in
 * Inbox by default and is visible to `gmail query` / `gmail get`),
 * but no message ever leaves the Google account.
 *
 * Attachments and user-visible labels:
 *   - `--attachment <path>` (repeatable) imports binary files as
 *     multipart/mixed parts. Used by `seed-resume-screening` to
 *     attach PDF resumes to candidate emails.
 *   - `--label-names <csv>` applies (and lazily creates) user labels
 *     at import time, so the imported message immediately matches
 *     Gmail-search filters like `label:candidate`.
 */
export default class GmailImport extends GoogleBaseCommand {
  static override description = 'Insert an RFC 2822 message into the mailbox without sending it'

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {
      description: 'Import a seeded fixture message attributed to an external sender',
      command: '$BIN google gmail import --from "aisha.patel@example.com" --to "demo@example.com" --subject "Q2 review followup" --body "Looking forward to it."',
      responseShape: {id: '18f0abc123', threadId: '18f0abc123', labelIds: ['INBOX', 'UNREAD']},
    },
    {
      description: 'Import a backdated message with a pre-set Message-ID for deterministic threading',
      command: '$BIN google gmail import --from "ben.rivera@example.com" --to "demo@example.com" --subject "Renewal timing" --body "..." --date "Mon, 03 Mar 2026 09:00:00 +0000" --message-id "story6.001@example.com"',
    },
    {
      description: 'Import a reply that threads against a prior imported message',
      command: '$BIN google gmail import --from "aisha.patel@example.com" --to "demo@example.com" --subject "Re: Q2 review followup" --body "Sounds good." --in-reply-to "story6.001@example.com" --references "story6.001@example.com"',
    },
    {
      description: 'Import a fixture message with a PDF attachment and a user-visible label',
      command: '$BIN google gmail import --from "maria.vasquez@example.com" --to "hiring@example.com" --subject "Application for Vineyard Production Manager" --body "Cover letter…" --attachment ./fixtures/resume.pdf --label-names "candidate"',
      responseShape: {id: '18f0abc123', threadId: '18f0abc123', labelIds: ['INBOX', 'UNREAD', 'Label_42']},
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Imported message confirmation',
    fields: {
      id: {type: 'string', description: 'Gmail-assigned ID of the imported message'},
      threadId: {type: 'string', description: 'Thread the message was attached to (Gmail clusters by Subject + References)'},
      labelIds: {type: 'array', description: 'Labels Gmail applied (INBOX/UNREAD plus any IDs resolved from --label-names)'},
    },
    example: {id: '18f0abc', threadId: '18f0abc', labelIds: ['INBOX', 'UNREAD']},
  }

  static override flagCategories: FlagCategorization = {
    from: ['bulk'],
    to: ['bulk'],
    subject: ['bulk'],
    body: ['bulk'],
    cc: ['bulk'],
    bcc: ['bulk'],
    date: ['bulk'],
    'message-id': ['bulk'],
    'in-reply-to': ['bulk'],
    references: ['bulk'],
    attachment: ['bulk'],
    'label-names': ['bulk'],
    'never-mark-spam': ['bulk'],
    'process-for-calendar': ['bulk'],
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
    from: Flags.string({
      description: 'Sender (From: header). Required for import — the message can be attributed to anyone.',
      required: true,
    }),
    to: Flags.string({
      description: 'Recipient(s) (To: header), comma-separated. Typically the importing mailbox itself.',
      required: true,
    }),
    subject: Flags.string({
      description: 'Email subject line',
      required: true,
    }),
    body: Flags.string({
      description: 'Email body text',
      required: true,
    }),
    cc: Flags.string({
      description: 'CC recipient(s), comma-separated',
    }),
    bcc: Flags.string({
      description: 'BCC recipient(s), comma-separated',
    }),
    date: Flags.string({
      description: 'RFC 2822 Date header (e.g. "Mon, 03 Mar 2026 09:00:00 +0000"). Drives Gmail internal date when --internal-date-source=dateHeader.',
    }),
    'message-id': Flags.string({
      description: 'RFC Message-ID (without angle brackets). If omitted, Gmail assigns one — set explicitly for deterministic threading across imports.',
    }),
    'in-reply-to': Flags.string({
      description: 'Message-ID of the parent message for threading (without angle brackets).',
    }),
    references: Flags.string({
      description: 'Whitespace-separated Message-IDs of ancestor messages in the thread.',
    }),
    attachment: Flags.string({
      description: 'Path to a file to attach (repeatable). Each value is an absolute path readable by the runtime; the file is base64-encoded into a multipart/mixed part.',
      multiple: true,
    }),
    'label-names': Flags.string({
      description: 'Comma-separated user-visible label names to apply at import time (e.g. "candidate,hiring"). Missing labels are auto-created.',
    }),
    'never-mark-spam': Flags.boolean({
      description: 'Tell Gmail to skip spam classification on this message.',
      default: true,
      allowNo: true,
    }),
    'process-for-calendar': Flags.boolean({
      description: 'Extract calendar invites from the message and add them to Google Calendar.',
      default: false,
      allowNo: true,
    }),
    'internal-date-source': Flags.string({
      description: 'Source for Gmail internal date: "dateHeader" (default, uses Date: header) or "receivedTime" (now).',
      options: ['dateHeader', 'receivedTime'],
      default: 'dateHeader',
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(GmailImport)

    if (this.isDryRun(flags, {
      from: flags.from,
      to: flags.to,
      subject: flags.subject,
      body: flags.body,
      date: flags.date,
      messageId: flags['message-id'],
      inReplyTo: flags['in-reply-to'],
      attachmentCount: flags.attachment?.length ?? 0,
      labelNames: flags['label-names'],
    })) return

    try {
      const conn = await this.getConnection()
      const gmailProxy = conn.gmail()
      const gmail = await gmailProxy.getClient() as import('@googleapis/gmail').gmail_v1.Gmail

      // Read attachments from disk and prepare them as multipart parts.
      const attachments: Attachment[] = []
      if (flags.attachment && flags.attachment.length > 0) {
        for (const path of flags.attachment) {
          const data = await readFile(path)
          attachments.push({
            filename: basename(path),
            contentType: inferContentType(path),
            data,
          })
        }
      }

      // Resolve label names to IDs (lazy-create missing labels).
      let labelIds: string[] | undefined
      if (flags['label-names']) {
        const requested = flags['label-names']
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
        if (requested.length > 0) {
          labelIds = await resolveLabelIds(gmail, requested)
        }
      }

      const raw = buildRawMessage({
        from: flags.from,
        to: flags.to,
        subject: flags.subject,
        body: flags.body,
        cc: flags.cc,
        bcc: flags.bcc,
        date: flags.date,
        messageId: flags['message-id'],
        inReplyTo: flags['in-reply-to'],
        references: flags.references,
        attachments: attachments.length > 0 ? attachments : undefined,
      })

      const response = await gmail.users.messages.import({
        userId: 'me',
        internalDateSource: flags['internal-date-source'],
        neverMarkSpam: flags['never-mark-spam'],
        processForCalendar: flags['process-for-calendar'],
        requestBody: {
          raw,
          ...(labelIds && labelIds.length > 0 ? {labelIds} : {}),
        },
      })

      await this.outputResult({
        id: response.data.id,
        threadId: response.data.threadId,
        labelIds: response.data.labelIds,
      }, this.buildContext({
        returned: 1,
        relatedCommands: [
          `$BIN google gmail get --message-id ${response.data.id}`,
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}

/**
 * Infer a Content-Type from a file extension. Falls back to
 * application/octet-stream when the extension is unknown.
 */
function inferContentType(path: string): string {
  const ext = extname(path).toLowerCase()
  switch (ext) {
    case '.pdf': return 'application/pdf'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.txt': return 'text/plain'
    case '.md': return 'text/markdown'
    case '.csv': return 'text/csv'
    case '.json': return 'application/json'
    case '.html': return 'text/html'
    default: return 'application/octet-stream'
  }
}

/**
 * Resolve user-visible label names to Gmail label IDs. Lists all
 * labels once; creates any that don't yet exist. Returns IDs in the
 * order of the requested names (deduped).
 */
async function resolveLabelIds(
  gmail: import('@googleapis/gmail').gmail_v1.Gmail,
  names: string[],
): Promise<string[]> {
  const listed = await gmail.users.labels.list({userId: 'me'})
  const existing = new Map<string, string>()
  for (const lbl of listed.data.labels || []) {
    if (lbl.name && lbl.id) {
      existing.set(lbl.name.toLowerCase(), lbl.id)
    }
  }

  const ids: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())

    let id = existing.get(name.toLowerCase())
    if (!id) {
      const created = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      })
      id = created.data.id ?? undefined
    }
    if (id) ids.push(id)
  }
  return ids
}
