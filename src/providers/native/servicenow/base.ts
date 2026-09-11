// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../../cli/base-command.js'
import type {ServiceNowClient} from './client.js'
import {servicenowCredentials} from './credentials.js'

/**
 * Base class for servicenow commands. Binds the credential schema for the auth
 * flags; `provider` is stamped on each command class by defineProvider, and
 * all credential resolution happens in the core.
 */
export abstract class ServiceNowBaseCommand extends AciBaseCommand {
  static baseFlags = AciBaseCommand.flagsFor(servicenowCredentials)

  protected getConnection(): Promise<ServiceNowClient> {
    return this.getClient<ServiceNowClient>()
  }
}
