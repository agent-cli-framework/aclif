// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {AciBaseCommand} from '../../base-command.js'
import {loadStandaloneManifestsSync} from '../../config/manifest-store.js'
import {getCommandContext} from '../../../core/command-context.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/** The manifests loaded for the current profile, with the file each came from. */
export default class ManifestsList extends AciBaseCommand {
  static override description = 'List the command manifests loaded for the current profile'

  static override flags = {...AciBaseCommand.baseFlags}

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const profile = getCommandContext(this.config)?.profile
    const byProvider = loadStandaloneManifestsSync(this.config.configDir, profile, (m) => this.warn(m))
    const manifests = Object.entries(byProvider).flatMap(([provider, list]) =>
      list.map(({manifest, file}) => ({id: manifest.id, provider, method: manifest.request.method, path: manifest.request.path, mutability: manifest.aciMetadata.mutability, file})),
    )
    await this.outputResult({profile: profile ?? null, configDir: this.config.configDir, manifests})
  }
}
