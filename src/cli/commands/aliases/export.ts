// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../base-command.js'
import {loadStandaloneAliasSetsSync} from '../../config/alias-store.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/** Every alias set in force, as AliasSet JSON, for hand-off to another checkout or host. */
export default class AliasesExport extends AciBaseCommand {
  static override description = 'Export the alias sets in force as AliasSet JSON'

  static override flags = {...AciBaseCommand.baseFlags}

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    await this.outputResult({sets: loadStandaloneAliasSetsSync(this.config.configDir, (m) => this.warn(m)).map((l) => l.set)})
  }
}
