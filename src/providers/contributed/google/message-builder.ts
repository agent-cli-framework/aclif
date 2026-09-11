// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * RFC 2822 message builder for Gmail API.
 *
 * The Gmail API requires messages to be sent as base64url-encoded RFC 2822
 * strings. This module constructs properly formatted email messages.
 *
 * Single-part path (no attachments) emits `Content-Type: text/plain` (or
 * text/html) with a base64-encoded body, matching the original behavior.
 *
 * Multipart path (one or more attachments) emits `Content-Type:
 * multipart/mixed; boundary="..."` with the body as the first part and
 * each attachment as a subsequent part with `Content-Disposition:
 * attachment`. Used by `gmail import --attachment …` to seed fixture
 * messages with PDF resumes etc.
 */

import {randomUUID} from 'node:crypto'

export interface Attachment {
  /** Filename surfaced in Gmail's UI (Content-Disposition). */
  filename: string
  /** MIME type, e.g. 'application/pdf'. */
  contentType: string
  /** Raw bytes; the builder base64-encodes and line-wraps. */
  data: Buffer
}

export interface EmailMessage {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
  from?: string
  /** In-Reply-To header for threading */
  inReplyTo?: string
  /** References header for threading */
  references?: string
  /** Thread ID for Gmail threading */
  threadId?: string
  /** Content type: 'text/plain' (default) or 'text/html' */
  contentType?: 'text/plain' | 'text/html'
  /** RFC 2822 Date header value. Used by `gmail import` to backdate seeded messages. */
  date?: string
  /** RFC 2822 Message-ID header value (without angle brackets). Generated if omitted. */
  messageId?: string
  /** Optional attachments. When present, message is emitted as multipart/mixed. */
  attachments?: Attachment[]
}

/**
 * Build an RFC 2822 message and encode it as base64url for the Gmail API.
 */
export function buildRawMessage(msg: EmailMessage): string {
  const lines: string[] = []
  const bodyContentType = msg.contentType || 'text/plain'
  const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0

  if (msg.from) {
    lines.push(`From: ${msg.from}`)
  }

  lines.push(`To: ${msg.to}`)

  if (msg.cc) {
    lines.push(`Cc: ${msg.cc}`)
  }

  if (msg.bcc) {
    lines.push(`Bcc: ${msg.bcc}`)
  }

  lines.push(`Subject: ${encodeSubject(msg.subject)}`)
  lines.push(`MIME-Version: 1.0`)

  if (msg.date) {
    lines.push(`Date: ${msg.date}`)
  }

  if (msg.messageId) {
    const id = msg.messageId.startsWith('<') ? msg.messageId : `<${msg.messageId}>`
    lines.push(`Message-ID: ${id}`)
  }

  if (msg.inReplyTo) {
    const id = msg.inReplyTo.startsWith('<') ? msg.inReplyTo : `<${msg.inReplyTo}>`
    lines.push(`In-Reply-To: ${id}`)
  }

  if (msg.references) {
    lines.push(`References: ${msg.references}`)
  }

  if (!hasAttachments) {
    // Single-part path — unchanged from the original behavior.
    lines.push(`Content-Type: ${bodyContentType}; charset=utf-8`)
    lines.push(`Content-Transfer-Encoding: base64`)
    lines.push('')
    lines.push(Buffer.from(msg.body, 'utf-8').toString('base64'))
  } else {
    // Multipart path.
    const boundary = `----=_aclif_${randomUUID()}`
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    lines.push('')
    lines.push('This is a multi-part message in MIME format.')

    // Body part
    lines.push(`--${boundary}`)
    lines.push(`Content-Type: ${bodyContentType}; charset=utf-8`)
    lines.push(`Content-Transfer-Encoding: base64`)
    lines.push('')
    lines.push(Buffer.from(msg.body, 'utf-8').toString('base64'))

    // Attachment parts
    for (const att of msg.attachments!) {
      lines.push(`--${boundary}`)
      lines.push(`Content-Type: ${att.contentType}; name="${att.filename}"`)
      lines.push(`Content-Disposition: attachment; filename="${att.filename}"`)
      lines.push(`Content-Transfer-Encoding: base64`)
      lines.push('')
      lines.push(wrapBase64(att.data.toString('base64')))
    }

    // Closing boundary
    lines.push(`--${boundary}--`)
  }

  const raw = lines.join('\r\n')
  return base64urlEncode(raw)
}

/**
 * Encode a string as base64url (URL-safe base64 without padding).
 */
function base64urlEncode(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Encode a Buffer (already-base64-encoded payload) wrapped at 76 cols per RFC 2045.
 */
function wrapBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? b64
}

/**
 * Encode subject line for RFC 2822 (handles non-ASCII characters).
 */
function encodeSubject(subject: string): string {
  // If the subject contains only ASCII, return as-is
  if (/^[\x20-\x7E]*$/.test(subject)) {
    return subject
  }

  // RFC 2047 encoded-word for non-ASCII
  const encoded = Buffer.from(subject, 'utf-8').toString('base64')
  return `=?UTF-8?B?${encoded}?=`
}
