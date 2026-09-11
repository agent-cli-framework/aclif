// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args} from '@oclif/core'

import {AciBaseCommand} from '../../base-command.js'
import {loadManifestFileSync} from '../../config/manifest-store.js'
import {placeholdersIn, providerOf, validateManifest} from '../../../core/manifest/manifest.js'
import {getRegistry} from '../../../core/provider/registry.js'
import type {AciMetadata} from '../../../core/contract/aci.js'

/**
 * Validate a command manifest file without a live instance: structure,
 * metadata vocabulary, declared placeholders, and that the provider exists.
 */
export default class ManifestsValidate extends AciBaseCommand {
  static override description = 'Validate a command manifest file (structure, metadata, placeholders, provider)'

  static override args = {
    file: Args.string({description: 'Manifest file (JSON or YAML)', required: true}),
  }

  static override flags = {...AciBaseCommand.baseFlags}

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: [],
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args} = await this.parse(ManifestsValidate)
    let manifest
    try {
      manifest = loadManifestFileSync(args.file)
    } catch (err) {
      this.outputError({code: 'INVALID_MANIFEST', message: (err as Error).message})
      this.exit(2)
    }
    const errors = validateManifest(manifest)
    const provider = providerOf(manifest)
    if (!getRegistry().has(provider)) errors.push(`provider '${provider}' is not registered (known: ${getRegistry().names().join(', ')})`)
    if (getRegistry().ownerOf(manifest.id)) errors.push(`id '${manifest.id}' collides with a built-in command`)
    if (errors.length) {
      this.outputError({code: 'INVALID_MANIFEST', message: `${args.file} is not a valid manifest`, syntaxGuide: errors.join('\n')})
      this.exit(2)
    }
    await this.outputResult({
      valid: true,
      id: manifest.id,
      provider,
      method: manifest.request.method,
      path: manifest.request.path,
      flags: Object.keys(manifest.flags),
      placeholders: placeholdersIn(manifest),
      mutability: manifest.aciMetadata.mutability,
    })
  }
}
