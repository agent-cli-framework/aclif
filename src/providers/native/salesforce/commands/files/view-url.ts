// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {SalesforceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

/**
 * Build the deterministic Salesforce Lightning URL for a Files
 * (ContentDocument) record. No API call — formatted from the
 * connection's instance URL and the supplied ContentDocument id.
 *
 * Mirrors `docusign envelopes view-url`. Used by the agent's
 * knowledge watcher to populate the user-facing click-through URL on
 * table-column documents whose bytes are fetched via the gateway
 * content-fetch route.
 *
 * Note: Salesforce Files are addressed by ContentDocument id (069...) at
 * the UI level, while the bytes live on ContentVersion (068...). The
 * locator carries the ContentVersion id; this URL builder takes the
 * ContentDocument id (which the column typically renders).
 */
export default class FilesViewUrl extends SalesforceBaseCommand {
  static override description =
    'Build the Salesforce Lightning URL for a Files (ContentDocument) record (deterministic — no API call)'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Get a click-through URL for a Salesforce Files record',
      command: '$BIN salesforce files view-url --content-document-id 069xxxxxxxxxx --json',
      responseShape: {
        contentDocumentId: '069xxxxxxxxxx',
        url: 'https://example.lightning.force.com/lightning/r/ContentDocument/069xxxxxxxxxx/view',
      },
    },
  ]

  static override responseShape: ResponseShape = {
    description:
      'Deterministic web-UI URL that opens the Files record in the user\'s ' +
      'Salesforce session. No API call is made — the URL is formatted ' +
      'from the connection\'s instance URL and the supplied ContentDocument id.',
    fields: {
      contentDocumentId: {type: 'string', description: 'Echo of the ContentDocument id'},
      url: {type: 'string', description: 'Lightning ContentDocument view URL'},
    },
    example: {
      contentDocumentId: '069xxx',
      url: 'https://example.lightning.force.com/lightning/r/ContentDocument/069xxx/view',
    },
  }

  static override flagCategories: FlagCategorization = {
    'content-document-id': ['filtering'],
    json: ['output'],
    'instance-url': ['auth'],
    'access-token': ['auth'],
    'sf-username': ['auth'],
    'sf-password': ['auth'],
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
    ...SalesforceBaseCommand.baseFlags,
    'content-document-id': Flags.string({
      description: 'ContentDocument id (Salesforce Files key prefix 069)',
      required: true,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(FilesViewUrl)

    try {
      const conn = await this.getConnection()
      const id = flags['content-document-id']
      const instance = (conn.instanceUrl || '').replace(/\/+$/, '')
      // Convert my-domain my-tenant.my.salesforce.com → my-tenant.lightning.force.com.
      // For sandboxes / scratch orgs the .my.salesforce.com host already redirects to
      // the matching lightning host, so the swap below is correct in all cases.
      const lightning = instance
        .replace(/\.my\.salesforce\.com$/, '.lightning.force.com')
        .replace(/\.salesforce\.com$/, '.lightning.force.com')
      const url = `${lightning}/lightning/r/ContentDocument/${encodeURIComponent(id)}/view`

      await this.outputResult(
        {contentDocumentId: id, url},
        this.buildContext({returned: 1}),
      )
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
