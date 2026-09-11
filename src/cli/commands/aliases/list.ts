// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../base-command.js'
import {loadStandaloneAliasSetsSync} from '../../config/alias-store.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/** The alias sets in force, in precedence order, with their entities and where each came from. */
export default class AliasesList extends AciBaseCommand {
  static override description = 'List the canonical alias sets in force, in precedence order'

  static override flags = {...AciBaseCommand.baseFlags}

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const sets = loadStandaloneAliasSetsSync(this.config.configDir, (m) => this.warn(m))
    await this.outputResult({
      sets: sets.map(({set, file}) => ({
        id: set.id,
        name: set.name,
        file,
        entities: set.entities.map((e) => ({canonical: e.canonical, providers: [...new Set(e.mappings.map((m) => m.provider))].sort(), fields: e.fields.length})),
      })),
    })
  }
}
