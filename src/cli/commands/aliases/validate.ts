// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args} from '@oclif/core'

import {AciBaseCommand} from '../../base-command.js'
import {loadAliasSetFileSync} from '../../config/alias-store.js'
import {getRegistry} from '../../../core/provider/registry.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/** Validate an alias set file: structure, snake_case names, and that every mapping names a registered provider. */
export default class AliasesValidate extends AciBaseCommand {
  static override description = 'Validate an alias set file'

  static override args = {
    file: Args.string({description: 'Alias set file (JSON or YAML)', required: true}),
  }

  static override flags = {...AciBaseCommand.baseFlags}

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args} = await this.parse(AliasesValidate)
    let set
    try {
      set = loadAliasSetFileSync(args.file)
    } catch (err) {
      this.outputError({code: 'INVALID_ALIAS_SET', message: (err as Error).message})
      this.exit(2)
    }
    const known = new Set(getRegistry().names())
    const unknown = [...new Set(set.entities.flatMap((e) => [...e.mappings, ...e.fields.flatMap((f) => f.mappings)].map((m) => m.provider)))].filter((p) => !known.has(p))
    if (unknown.length) {
      this.outputError({code: 'INVALID_ALIAS_SET', message: `${args.file} maps to unregistered providers: ${unknown.join(', ')}`, syntaxGuide: `Registered: ${[...known].join(', ')}`})
      this.exit(2)
    }
    await this.outputResult({valid: true, id: set.id, entities: set.entities.map((e) => e.canonical)})
  }
}
