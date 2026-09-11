// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args, Flags} from '@oclif/core'
import {copyFile, mkdir} from 'node:fs/promises'
import {basename, join} from 'node:path'

import {AciBaseCommand} from '../../base-command.js'
import {aliasesDir, loadAliasSetFileSync} from '../../config/alias-store.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/** Copy a validated alias set into <configDir>/aliases/ so it is in force from the next command. */
export default class AliasesImport extends AciBaseCommand {
  static override description = 'Import an alias set file (for example an export from a gateway) into the config directory'

  static override args = {
    file: Args.string({description: 'Alias set file (JSON or YAML)', required: true}),
  }

  static override flags = {
    ...AciBaseCommand.baseFlags,
    name: Flags.string({description: 'File name to store as (defaults to the source file name)'}),
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'create', idempotent: true, reversible: true, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args, flags} = await this.parse(AliasesImport)
    let set
    try {
      set = loadAliasSetFileSync(args.file)
    } catch (err) {
      this.outputError({code: 'INVALID_ALIAS_SET', message: (err as Error).message})
      this.exit(2)
    }
    const target = join(aliasesDir(this.config.configDir), flags.name ?? basename(args.file))
    if (this.isDryRun(flags, {copy: args.file, to: target, id: set.id})) return
    await mkdir(aliasesDir(this.config.configDir), {recursive: true, mode: 0o700})
    await copyFile(args.file, target)
    await this.outputResult({imported: set.id, file: target, entities: set.entities.length})
  }
}
