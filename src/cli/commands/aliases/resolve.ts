// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'

import {AciBaseCommand} from '../../base-command.js'
import {FileAliasStore} from '../../config/alias-store.js'
import {nearestCanonical} from '../../../core/alias/alias-set.js'
import {getRegistry} from '../../../core/provider/registry.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/** Resolve a canonical entity to its native name and field map for one provider and instance. */
export default class AliasesResolve extends AciBaseCommand {
  static override description = 'Resolve a canonical entity name to the native entity and field names for a provider and instance'

  static override args = {
    canonical: Args.string({description: 'Canonical entity name, e.g. customer', required: true}),
  }

  static override flags = {
    ...AciBaseCommand.baseFlags,
    provider: Flags.string({description: 'Provider to resolve for', required: true}),
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args, flags} = await this.parse(AliasesResolve)
    if (!getRegistry().has(flags.provider)) {
      this.outputError({code: 'UNKNOWN_PROVIDER', message: `Unknown provider: ${flags.provider}`, syntaxGuide: `Available: ${getRegistry().names().join(', ')}`})
      this.exit(2)
    }
    const store = new FileAliasStore(this.config.configDir, (m) => this.warn(m))
    const instance = flags.instance ?? '*'
    const resolved = await store.resolveEntity(args.canonical, flags.provider, instance)
    if (!resolved) {
      const near = nearestCanonical(await store.sets(), args.canonical)
      this.outputError({
        code: 'CANONICAL_NOT_FOUND',
        message: `No mapping for canonical '${args.canonical}' on ${flags.provider}${instance === '*' ? '' : ` instance '${instance}'`}`,
        ...(near.length ? {syntaxGuide: `Nearest canonical names: ${near.join(', ')}`} : {}),
      })
      this.exit(2)
    }
    await this.outputResult({canonical: args.canonical, provider: flags.provider, instance, native: resolved.native, fields: resolved.fieldMap, set: resolved.set})
  }
}
