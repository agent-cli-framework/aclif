// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {AgentForceBaseCommand} from '../base.js'
import type {AgentDescriptor} from '../client.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'

/**
 * Introspect Agentforce capabilities for the configured org.
 *
 * Returns:
 *  - reachability + resolved API host
 *  - the list of agents the connected ECA can see (BotDefinition rows)
 *  - the configured default agent
 *
 * Topics + actions per agent live in metadata that requires the Tooling
 * API and per-agent walks; out of scope for Layer 1. The shape is
 * forward-compatible: agents[].topics will populate once Layer 2 lands.
 */
export default class AgentForceIntrospect extends AgentForceBaseCommand {
  static override description =
    'Introspect Agentforce capabilities: visible agents, default agent, and reachability'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 2,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "What the External Client App credentials are permitted to do",
    fields: {
      introspectedAt: {type: "string", description: "ISO timestamp"},
      myDomainUrl: {type: "string", description: "My Domain URL of the org"},
      orgApiHost: {type: "string", description: "host answering org API calls"},
      agentApiHost: {type: "string", description: "host answering Agent API calls"},
      defaultAgentId: {type: "string", description: "agent id from credentials, or null"},
      systemPermissions: {type: "object", description: "{agentApiAccess, clientCredentialsFlow, ...}"},
    },
    example: {"introspectedAt": "2026-09-11T00:00:00.000Z", "myDomainUrl": "https://example.my.salesforce.com", "orgApiHost": "example.my.salesforce.com", "agentApiHost": "api.salesforce.com", "defaultAgentId": null, "systemPermissions": {"agentApiAccess": true, "clientCredentialsFlow": true}},
  }

  static override flags = {
    ...AgentForceBaseCommand.baseFlags,
    'agents-limit': Flags.integer({
      description: 'Maximum agents to enumerate',
      default: 50,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(AgentForceIntrospect)

    try {
      const client = await this.getConnection()
      const probe = await client.ping()

      // Agent listing is best-effort: if the org has no BotDefinitions
      // or the connected user lacks query permission, fall back to the
      // configured default agent rather than failing the whole probe.
      let agents: AgentDescriptor[] = []
      try {
        agents = await client.listAgents({limit: flags['agents-limit']})
      } catch (err) {
        process.stderr.write(`[INTROSPECT] agents list failed (non-fatal): ${(err as Error).message}\n`)
      }

      const result = {
        introspectedAt: new Date().toISOString(),
        myDomainUrl: client.myDomainUrl,
        orgApiHost: probe.orgApiHost,
        agentApiHost: probe.agentApiHost,
        defaultAgentId: client.defaultAgentId ?? null,
        systemPermissions: {
          agentApiAccess: true,
          clientCredentialsFlow: true,
        },
        agents: agents.map((a) => ({
          id: a.id,
          developerName: a.developerName,
          label: a.label,
          description: a.description,
          type: a.type,
          topics: [] as Array<{name: string; actions: string[]}>,
        })),
      }

      await this.outputResult(result, this.buildContext({
        returned: result.agents.length,
        refinements: [
          'agents[].topics is empty in Layer 1 — Tooling API walk required to populate.',
          'Use `agentforce sessions start --agent-id <id>` to begin a conversation.',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
