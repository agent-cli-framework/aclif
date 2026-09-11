// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../../cli/base-command.js'
import type {DocuSignClient} from './client.js'
import {docusignCredentials} from './credentials.js'

/**
 * Base class for docusign commands. Binds the credential schema for the auth
 * flags; `provider` is stamped on each command class by defineProvider, and
 * all credential resolution happens in the core.
 */
export abstract class DocuSignBaseCommand extends AciBaseCommand {
  static baseFlags = AciBaseCommand.flagsFor(docusignCredentials)

  protected getConnection(): Promise<DocuSignClient> {
    return this.getClient<DocuSignClient>()
  }
}
