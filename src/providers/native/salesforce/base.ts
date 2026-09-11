// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../../cli/base-command.js'
import type {Connection} from 'jsforce'
import {salesforceCredentials} from './credentials.js'

/**
 * Base class for salesforce commands. Binds the credential schema for the auth
 * flags; `provider` is stamped on each command class by defineProvider, and
 * all credential resolution happens in the core.
 */
export abstract class SalesforceBaseCommand extends AciBaseCommand {
  static baseFlags = AciBaseCommand.flagsFor(salesforceCredentials)

  protected getConnection(): Promise<Connection> {
    return this.getClient<Connection>()
  }
}
