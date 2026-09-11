// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AgentForceBaseCommand} from '../base.js'
import {agentforceMetadata} from '../metadata.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

/**
 * Discover the Agentforce resource surface exposed by aclif.
 *
 * Mirrors the DocuSign `discover` shape: static topic list from
 * provider metadata + a lightweight reachability ping to confirm
 * the credentials can mint a token against the org.
 */
export default class AgentForceDiscover extends AgentForceBaseCommand {
  static override description =
    'List Agentforce resources exposed by $BIN and verify the org is reachable with the configured credentials'

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
    description: "Agentforce reachability and the command topics available",
    fields: {
      discoveredAt: {type: "string", description: "ISO timestamp"},
      myDomainUrl: {type: "string", description: "My Domain URL of the org"},
      orgApiHost: {type: "string", description: "host answering org API calls"},
      agentApiHost: {type: "string", description: "host answering Agent API calls"},
      defaultAgentId: {type: "string", description: "agent id from credentials, or null"},
      topics: {type: "array", description: "array of {name, description, commands, keyFields}"},
      reachable: {type: "boolean", description: "the Agent API answered the probe"},
    },
    example: {"discoveredAt": "2026-09-11T00:00:00.000Z", "myDomainUrl": "https://example.my.salesforce.com", "orgApiHost": "example.my.salesforce.com", "agentApiHost": "api.salesforce.com", "defaultAgentId": null, "topics": [{"name": "agents", "description": "Agents", "commands": ["list"], "keyFields": ["id"]}], "reachable": true},
  }

  static override flags = {
    ...AgentForceBaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return

    try {
      const client = await this.getConnection()
      const probe = await client.ping()

      const result = {
        discoveredAt: new Date().toISOString(),
        myDomainUrl: client.myDomainUrl,
        orgApiHost: probe.orgApiHost,
        agentApiHost: probe.agentApiHost,
        defaultAgentId: client.defaultAgentId ?? null,
        topics: Object.keys(agentforceMetadata.topics).map((name) => ({
          name,
          description: agentforceMetadata.topics[name].description,
          commands: agentforceMetadata.topics[name].commands,
          keyFields: agentforceMetadata.topics[name].keyFields,
        })),
        reachable: true,
      }

      await this.outputResult(result, this.buildContext({
        returned: Object.keys(agentforceMetadata.topics).length,
        relatedCommands: [
          '$BIN agentforce agents list --json',
          '$BIN agentforce sessions start --json',
          '$BIN agentforce introspect --json',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
