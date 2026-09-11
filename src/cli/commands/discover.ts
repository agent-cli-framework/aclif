// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {AciMetadata, ResponseShape} from '../../core/contract/aci.js'
import {AciBaseCommand} from '../base-command.js'
import {getRegistry} from '../../core/provider/registry.js'
import {credentialsFromSchema, valuesFromEnv} from '../../core/provider/credential-schema.js'

/**
 * Multi-provider discovery: every registered provider with its tier,
 * topic and command counts, and whether credentials are configured.
 * Status comes from each provider's credential schema against the
 * environment, which the init hook has already filled from the selected
 * profile.
 *
 * Examples:
 *   aclif discover --json
 */
export default class Discover extends AciBaseCommand {
  static override description = 'List all available providers, topics, and commands'

  static override flags = {
    ...AciBaseCommand.baseFlags,
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 0,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: 'Every registered provider with tier, counts, and credential status',
    fields: {
      providers: {type: 'array', description: 'array of {name, displayName, description, tier, topics, commands, status, auth}'},
      total_commands: {type: 'number', description: 'number'},
      suggested_start: {type: 'string', description: 'string'},
    },
    example: {
      providers: [{name: 'salesforce', displayName: 'Salesforce', description: '...', tier: 'native', topics: 4, commands: 18, status: 'not configured', auth: null}],
      total_commands: 94,
      suggested_start: '$BIN learn <provider> --json',
    },
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const registry = getRegistry()

    const providers = []
    for (const {plugin, tier} of registry.entries()) {
      const resolved = credentialsFromSchema(plugin.credentials, valuesFromEnv(plugin.credentials, process.env))
      providers.push({
        name: plugin.name,
        displayName: plugin.displayName,
        description: plugin.description,
        tier,
        topics: Object.keys(plugin.metadata.topics).length,
        commands: Object.keys(plugin.commands).length,
        status: resolved ? 'configured' : 'not configured',
        auth: resolved ? resolved.path.description : null,
      })
    }

    this.log(JSON.stringify({
      providers,
      total_commands: providers.reduce((sum, p) => sum + p.commands, 0),
      suggested_start: {type: '$BIN', description: '$BIN learn <provider> --json'},
    }, null, 2))
  }
}
