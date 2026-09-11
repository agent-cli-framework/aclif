// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../../cli/base-command.js'
import type {GoogleWorkspaceClient} from './client.js'
import {googleCredentials} from './credentials.js'

/**
 * Base class for google commands. Binds the credential schema for the auth
 * flags; `provider` is stamped on each command class by defineProvider, and
 * all credential resolution happens in the core.
 */
export abstract class GoogleBaseCommand extends AciBaseCommand {
  static baseFlags = AciBaseCommand.flagsFor(googleCredentials)

  protected getConnection(): Promise<GoogleWorkspaceClient> {
    return this.getClient<GoogleWorkspaceClient>()
  }
}
