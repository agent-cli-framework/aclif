// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {AgentForceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../../../../core/contract/aci.js'

export default class SessionsStart extends AgentForceBaseCommand {
  static override description = 'Start a new Agentforce conversation session against an agent'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Start a session against the configured default agent',
      command: '$BIN agentforce sessions start --json',
      responseShape: {sessionId: '5e3...', agentId: '0XxAB...', messages: []},
    },
    {
      description: 'Start a session against a specific agent',
      command: '$BIN agentforce sessions start --agent-id 0XxAB000000XXXXAB1 --json',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Session-start envelope returned by the Agent API',
    fields: {
      sessionId: {type: 'string', description: 'Opaque session ID used in subsequent message/end calls'},
      agentId: {type: 'string', description: 'The agent the session was started against'},
      messages: {type: 'array', description: 'Initial messages emitted by the agent (often empty)'},
    },
    example: {sessionId: '5e3a1c8c-...', agentId: '0XxAB000000XXXXAB1', messages: []},
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'create',
    idempotent: false,
    reversible: true,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [
      'AgentForce External Client App configured with client-credentials flow (see docs/AGENTFORCE_SETUP.md)',
    ],
  }

  static override flags = {
    ...AgentForceBaseCommand.baseFlags,
    'external-session-key': Flags.string({
      description: 'Idempotency key for the session (UUID auto-generated if omitted)',
    }),
    'bypass-user': Flags.boolean({
      description:
        'Run the session as the agent\'s auto-created user (true) instead of the External Client App\'s Run As user (false, default). ' +
        'Setting true requires an available Einstein Prompt Templates PSL on the agent user — easy to exhaust in dev orgs.',
      default: false,
      allowNo: true,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(SessionsStart)
    if (this.isDryRun(flags, {agentId: flags['agent-id'] ?? '(default agent from credentials)'})) return

    try {
      const client = await this.getConnection()
      const agentId = flags['agent-id'] || client.defaultAgentId
      if (!agentId) {
        this.error(
          'No agent ID supplied. Pass --agent-id, set AGENTFORCE_AGENT_ID, ' +
          'or configure a default_agent_id in the vault credentials.',
          {exit: 3},
        )
      }

      const response = await client.startSession(agentId, {
        externalSessionKey: flags['external-session-key'],
        bypassUser: flags['bypass-user'],
      })

      await this.outputResult(
        {
          sessionId: response.sessionId,
          agentId,
          messages: response.messages ?? [],
        },
        this.buildContext({
          relatedCommands: [
            `$BIN agentforce sessions message --session-id ${response.sessionId} --message "..." --json`,
            `$BIN agentforce sessions end --session-id ${response.sessionId} --json`,
          ],
        }),
      )
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
