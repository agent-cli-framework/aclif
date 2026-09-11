// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args} from '@oclif/core'

import {AciBaseCommand} from '../../base-command.js'
import {FileSessionCache} from '../../config/session-cache.js'
import {getRegistry} from '../../../core/provider/registry.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/** Remove cached sessions so the next command logs in again. */
export default class AuthLogout extends AciBaseCommand {
  static override description = 'Remove cached sessions for one provider, or all providers'

  static override args = {
    provider: Args.string({description: 'Provider whose sessions to clear; all when omitted', required: false}),
  }

  static override flags = {...AciBaseCommand.baseFlags}

  static override aciMetadata: AciMetadata = {
    mutability: 'delete', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args} = await this.parse(AuthLogout)
    if (args.provider && !getRegistry().has(args.provider)) {
      this.outputError({code: 'UNKNOWN_PROVIDER', message: `Unknown provider: ${args.provider}`, syntaxGuide: `Available: ${getRegistry().names().join(', ')}`})
      this.exit(2)
    }
    const removed = await new FileSessionCache(this.config.cacheDir).clear(args.provider)
    await this.outputResult({provider: args.provider ?? null, removed})
  }
}
