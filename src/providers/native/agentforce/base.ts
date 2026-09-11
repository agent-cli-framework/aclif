// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../../cli/base-command.js'
import type {AgentForceClient} from './client.js'
import {agentforceCredentials} from './credentials.js'

/**
 * Base class for Agentforce commands. Binds the credential schema for the
 * auth flags; `provider` is stamped on each command class by
 * defineProvider, and all credential resolution happens in the core.
 */
export abstract class AgentForceBaseCommand extends AciBaseCommand {
  static baseFlags = AciBaseCommand.flagsFor(agentforceCredentials)

  protected getConnection(): Promise<AgentForceClient> {
    return this.getClient<AgentForceClient>()
  }
}
