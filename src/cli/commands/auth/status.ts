// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../base-command.js'
import {FileSessionCache} from '../../config/session-cache.js'
import {getCommandContext} from '../../../core/command-context.js'
import {describeEntry, isExpired} from '../../../core/credentials/session-cache.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/** Identity, config file, profile, and cached sessions. Never prints a secret. */
export default class AuthStatus extends AciBaseCommand {
  static override description = 'Show the resolved identity, config file, profile, and cached sessions (never secrets)'

  static override flags = {...AciBaseCommand.baseFlags}

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const context = getCommandContext(this.config)
    const sessions = (await new FileSessionCache(this.config.cacheDir).list()).map((e) => ({...describeEntry(e), expired: isExpired(e)}))
    await this.outputResult({
      identity: context?.identity ? {id: context.identity.id, email: context.identity.email ?? null, provider: context.identityProvider} : null,
      identityProvider: context?.identityProvider ?? 'anonymous',
      configFile: context?.configFile ?? null,
      profile: context?.profile ?? null,
      sessions,
    })
  }
}
