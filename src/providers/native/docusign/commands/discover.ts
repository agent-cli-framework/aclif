// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {DocuSignBaseCommand} from '../base.js'
import {docusignMetadata} from '../metadata.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

/**
 * Discover the DocuSign resource surface exposed by aclif.
 *
 * Unlike ServiceNow's dynamic sys_db_object walk, DocuSign's resource
 * shape is static (envelopes, templates, recipients, etc.) so discover
 * returns provider metadata plus a lightweight account ping so callers
 * can verify end-to-end reachability.
 */
export default class DocuSignDiscover extends DocuSignBaseCommand {
  static override description = 'List DocuSign resources exposed by $BIN and verify account reachability'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "DocuSign account reachability and the command topics available",
    fields: {
      discoveredAt: {type: "string", description: "ISO timestamp"},
      baseUri: {type: "string", description: "account base URI"},
      accountId: {type: "string", description: "API account id"},
      topics: {type: "array", description: "array of {name, description, commands, keyFields}"},
      reachable: {type: "boolean", description: "the account answered the probe"},
      envelopesVisible: {type: "number", description: "envelopes the probe could list"},
    },
    example: {"discoveredAt": "2026-09-11T00:00:00.000Z", "baseUri": "https://demo.docusign.net", "accountId": "00000000-0000-0000-0000-000000000000", "topics": [{"name": "envelopes", "description": "Envelopes", "commands": ["list"], "keyFields": ["envelopeId"]}], "reachable": true, "envelopesVisible": 3},
  }

  static override flags = {
    ...DocuSignBaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return

    try {
      const client = await this.getConnection()
      // Lightweight reachability probe: one envelope from the last 24 h.
      const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const probe = await client.listEnvelopes({fromDate, count: 1})

      const result = {
        discoveredAt: new Date().toISOString(),
        baseUri: client.baseUri,
        accountId: client.accountId,
        topics: Object.keys(docusignMetadata.topics).map((name) => ({
          name,
          description: docusignMetadata.topics[name].description,
          commands: docusignMetadata.topics[name].commands,
          keyFields: docusignMetadata.topics[name].keyFields,
        })),
        reachable: true,
        envelopesVisible: probe.envelopes?.length ?? 0,
      }

      await this.outputResult(result, this.buildContext({
        returned: Object.keys(docusignMetadata.topics).length,
        relatedCommands: [
          '$BIN docusign envelopes list --json',
          '$BIN docusign introspect --json',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
