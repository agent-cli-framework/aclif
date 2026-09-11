// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Turn a CommandManifest into a command class. The class is a real
 * AciBaseCommand subclass: it answers every introspection flag, carries the
 * manifest's aciMetadata for the policy hooks and the capability gate,
 * resolves credentials through the provider's schema, and issues the
 * request through the provider's HttpAdapter.
 */
import {Flags} from '@oclif/core'

import {AciBaseCommand} from '../../cli/base-command.js'
import type {AciMetadata, CommandExample, ResponseContext, ResponseShape} from '../contract/aci.js'
import type {ProviderCommandClass, ProviderPlugin} from '../provider/plugin.js'
import {resolveRequest, validateManifest, type CommandManifest, type ManifestFlag} from './manifest.js'

function oclifFlag(f: ManifestFlag): unknown {
  const common: Record<string, unknown> = {description: f.description}
  if (f.required) common.required = true
  if (f.default !== undefined) common.default = f.default
  if (f.options) common.options = f.options
  switch (f.type) {
    case 'integer':
      return Flags.integer(common as never)
    case 'boolean':
      return Flags.boolean({description: f.description, default: Boolean(f.default)})
    default:
      return Flags.string(common as never)
  }
}

const MANIFEST_CONTEXT: ResponseContext = {
  pagination: null,
  rateLimit: null,
  availableFields: [],
  refinements: [],
  relatedCommands: [],
  source: 'manifest',
}

export function manifestCommand(manifest: CommandManifest, plugin: ProviderPlugin): ProviderCommandClass {
  const errors = validateManifest(manifest)
  if (errors.length) throw new Error(`Invalid manifest '${manifest.id}':\n  ${errors.join('\n  ')}`)
  if (!manifest.id.startsWith(`${plugin.name}:`)) throw new Error(`Manifest '${manifest.id}' does not belong to provider '${plugin.name}'`)

  const flagDefs: Record<string, unknown> = {...AciBaseCommand.flagsFor(plugin.credentials)}
  for (const [name, f] of Object.entries(manifest.flags)) {
    if (name in flagDefs) throw new Error(`Manifest '${manifest.id}' flag --${name} collides with a base or auth flag`)
    flagDefs[name] = oclifFlag(f)
  }

  class ManifestCommand extends AciBaseCommand {
    static override id = manifest.id
    static override description = manifest.description
    static override flags = flagDefs as typeof AciBaseCommand.baseFlags
    static override aciMetadata: AciMetadata = manifest.aciMetadata
    static override responseShape: ResponseShape | null = manifest.responseShape ?? null
    static override aciExamples: CommandExample[] = manifest.aciExamples ?? []
    static override provider = plugin
    static manifest = manifest

    async run(): Promise<void> {
      if (this.shouldSkipExecution()) return
      const {flags} = await this.parse(ManifestCommand)
      try {
        const req = resolveRequest(manifest, flags as Record<string, unknown>)
        if (manifest.aciMetadata.mutability !== 'read') {
          this.registerMutation()
          if (this.isDryRun(flags as Record<string, unknown>, {method: req.method, path: req.path, query: req.query ?? null, body: req.body ?? null})) return
        }
        const client = await this.getClient()
        const http = plugin.http?.(client)
        if (!http) {
          this.outputError({code: 'NO_HTTP_ADAPTER', message: `${plugin.displayName} does not expose a raw HTTP adapter, so manifest commands cannot run against it`})
          this.exit(2)
        }
        const result = await http.request(req)
        await this.outputResult(result, MANIFEST_CONTEXT)
      } catch (err) {
        this.outputError(this.formatError(err))
      }
    }
  }

  return ManifestCommand as unknown as ProviderCommandClass
}
