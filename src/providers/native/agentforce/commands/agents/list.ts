// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {AgentForceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../../../../core/contract/aci.js'

export default class AgentsList extends AgentForceBaseCommand {
  static override description = 'List Agentforce agents visible to the connected org'

  static override aciExamples: CommandExample[] = [
    {
      description: 'List up to 50 agents in the org',
      command: '$BIN agentforce agents list --json',
      responseShape: {agents: [{id: '0XxAB000000XXXXAB1', developerName: 'Sales_Coach', label: 'Sales Coach'}]},
    },
    {
      description: 'List up to 10 agents (smaller LLM context)',
      command: '$BIN agentforce agents list --limit 10 --json',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'List of agents queryable from BotDefinition',
    fields: {
      agents: {type: 'array', description: 'Agent records with id, developerName, label, description'},
      defaultAgentId: {type: 'string', nullable: true, description: 'The default agent configured in vault, if any'},
    },
    example: {
      agents: [{id: '0XxAB000000XXXXAB1', developerName: 'Sales_Coach', label: 'Sales Coach'}],
      defaultAgentId: '0XxAB000000XXXXAB1',
    },
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'filtered_set',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override flags = {
    ...AgentForceBaseCommand.baseFlags,
    limit: Flags.integer({
      description: 'Maximum agents to return',
      default: 50,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(AgentsList)

    try {
      const client = await this.getConnection()
      const agents = await client.listAgents({limit: flags.limit})

      await this.outputResult(
        {agents, defaultAgentId: client.defaultAgentId ?? null},
        this.buildContext({
          returned: agents.length,
          relatedCommands: [
            '$BIN agentforce sessions start --agent-id <id> --json',
            '$BIN agentforce introspect --json',
          ],
        }),
      )
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
