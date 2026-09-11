// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {readFile} from 'node:fs/promises'
import {basename, extname} from 'node:path'

import {marked} from 'marked'

/**
 * Shape accepted as a document on a DocuSign envelope.
 *
 * We always send fileExtension="html" and render markdown -> HTML on
 * the client — DocuSign does not accept raw markdown but renders HTML
 * natively, which saves us a PDF toolchain.
 */
export interface EnvelopeDocument {
  documentBase64: string
  name: string
  fileExtension: 'html'
  documentId: string
}

/**
 * Read a markdown file and return a DocuSign envelope document.
 *
 * The rendered HTML is wrapped in a minimal A4-ish page shell and a
 * literal `/sn1/` anchor is appended before </body> so the caller can
 * attach an anchored signHere tab without hand-placing coordinates.
 * If the markdown source already contains `/sn1/` we do not append a
 * second one.
 */
export async function markdownToEnvelopeDoc(
  mdPath: string,
  documentId = '1',
  documentName?: string,
): Promise<EnvelopeDocument> {
  const raw = await readFile(mdPath, 'utf8')
  const html = await marked.parse(raw, {async: true})

  const hasAnchor = raw.includes('/sn1/') || html.includes('/sn1/')
  const body = hasAnchor ? html : `${html}\n<p style="margin-top:2rem">Signature: /sn1/</p>`

  const wrapped =
    '<!DOCTYPE html>\n' +
    '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Georgia,serif;max-width:700px;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#111}' +
    'h1,h2,h3{font-family:Helvetica,Arial,sans-serif;color:#222}' +
    'p{margin:0.75rem 0}' +
    '</style></head><body>\n' +
    body +
    '\n</body></html>\n'

  const base = documentName || basename(mdPath, extname(mdPath))
  return {
    documentBase64: Buffer.from(wrapped, 'utf8').toString('base64'),
    name: base,
    fileExtension: 'html',
    documentId,
  }
}
