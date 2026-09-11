// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {AgentForceBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../../../../core/contract/aci.js'

export default class SessionsMessage extends AgentForceBaseCommand {
  static override description = 'Send a Text message to an active Agentforce session and return the agent reply'

  static override aciExamples: CommandExample[] = [
    {
      description: 'Ask an active session a question',
      command: '$BIN agentforce sessions message --session-id 5e3a1c8c-... --message "Summarize Acme Corp\'s open opportunities" --json',
      responseShape: {messages: [{type: 'Inform', message: 'Acme Corp has 3 open opportunities...', result: {}}]},
    },
    {
      description: 'Continue a multi-turn conversation (advance sequenceId per turn)',
      command: '$BIN agentforce sessions message --session-id 5e3a1c8c-... --message "Draft outreach for the top one" --sequence-id 2 --json',
    },
  ]

  static override responseShape: ResponseShape = {
    description: 'Agent reply envelope with one or more messages (some may carry structured action results)',
    fields: {
      messages: {type: 'array', description: 'Reply messages — Text payloads or action results'},
      _links: {type: 'object', nullable: true, description: 'HATEOAS-style follow-up URLs (rarely used)'},
    },
    example: {messages: [{type: 'Inform', message: 'Acme Corp has 3 open opportunities...'}]},
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'update',
    idempotent: false,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: ['An active session started via `$BIN agentforce sessions start`'],
  }

  static override flags = {
    ...AgentForceBaseCommand.baseFlags,
    'session-id': Flags.string({
      description: 'The session ID returned by `sessions start`',
      required: true,
    }),
    message: Flags.string({
      description: 'The Text message to send to the agent',
      required: true,
    }),
    'sequence-id': Flags.integer({
      description: 'Monotonically increasing message sequence number within the session (default: 1)',
      default: 1,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(SessionsMessage)
    if (this.isDryRun(flags, {sessionId: flags['session-id'], message: flags.message, sequenceId: flags['sequence-id']})) return

    try {
      const client = await this.getConnection()
      const response = await client.sendMessage(flags['session-id'], {
        message: {
          sequenceId: flags['sequence-id'],
          type: 'Text',
          text: flags.message,
        },
      })

      await this.outputResult(response, this.buildContext({
        returned: response.messages?.length ?? 0,
        relatedCommands: [
          `$BIN agentforce sessions message --session-id ${flags['session-id']} --message "..." --sequence-id ${flags['sequence-id'] + 1} --json`,
          `$BIN agentforce sessions end --session-id ${flags['session-id']} --json`,
        ],
        refinements: [
          'Increment --sequence-id for each follow-up turn in the same session.',
          'Inspect messages[].type to distinguish Inform / Reply / TransferSucceeded / action-result envelopes.',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
