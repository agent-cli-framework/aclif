// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {AgentForceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../../../../core/contract/aci.js'

export default class SessionsEnd extends AgentForceBaseCommand {
  static override description = 'End an active Agentforce session'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Close a session when the conversation is finished',
      command: '$BIN agentforce sessions end --session-id 5e3a1c8c-... --confirm --json',
      responseShape: {success: true, sessionId: '5e3a1c8c-...'},
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Confirmation envelope — the Agent API returns 204 No Content on success',
    fields: {
      sessionId: {type: 'string', description: 'The session that was ended'},
      ended: {type: 'boolean', description: 'True when the DELETE succeeded'},
    },
    example: {sessionId: '5e3a1c8c-...', ended: true},
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'delete',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: true,
    prerequisites: ['A session ID from a prior `sessions start` call'],
  }

  static override flags = {
    ...AgentForceBaseCommand.baseFlags,
    'session-id': Flags.string({
      description: 'The session ID to terminate',
      required: true,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(SessionsEnd)
    if (this.isDryRun(flags, {sessionId: flags['session-id']})) return

    try {
      const client = await this.getConnection()
      await client.endSession(flags['session-id'])

      await this.outputResult(
        {sessionId: flags['session-id'], ended: true},
        this.buildContext({
          relatedCommands: ['$BIN agentforce sessions start --json'],
        }),
      )
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
