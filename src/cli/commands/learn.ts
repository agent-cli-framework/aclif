// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Args} from '@oclif/core'

import type {AciMetadata, ResponseShape} from '../../core/contract/aci.js'
import {AciBaseCommand} from '../base-command.js'
import {credentialsFromSchema, describePaths, valuesFromEnv} from '../../core/provider/credential-schema.js'
import {getRegistry} from '../../core/provider/registry.js'
import {instanceKey} from '../../core/provider/tenant.js'
import {canonicalEntitiesFor} from '../../core/alias/alias-set.js'

/**
 * Agent briefing: a compact summary of one provider. Overview, auth
 * status and the accepted auth paths, topics with key fields and common
 * patterns, and query syntax.
 *
 * Examples:
 *   aclif learn salesforce --json
 */
export default class Learn extends AciBaseCommand {
  static override description = 'Compact agent briefing for a provider: overview, topics, key fields, common patterns'

  static override args = {
    provider: Args.string({
      description: 'Provider name (see discover)',
      required: true,
    }),
  }

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
    description: 'Compact briefing for one provider',
    fields: {
      provider: {type: 'string', description: 'string'},
      tier: {type: 'native', description: 'native | contributed | private'},
      overview: {type: 'string', description: 'string'},
      auth_status: {type: 'string', description: 'string'},
      auth_paths: {type: 'array', description: 'array of string'},
      topics: {type: 'object', description: 'object keyed by topic: {description, commands, key_fields, common_patterns}'},
      query_syntax: {type: 'string', description: 'string'},
      provider_specific_flags: {type: 'array', description: 'array of string'},
    },
    example: {
      provider: 'salesforce',
      tier: 'native',
      overview: '...',
      auth_status: 'not configured',
      auth_paths: ['Session token: --instance-url + --access-token (or SF_INSTANCE_URL, SF_ACCESS_TOKEN)'],
      topics: {data: {description: '...', commands: ['query'], key_fields: ['Id'], common_patterns: ['...']}},
      query_syntax: 'SOQL',
      provider_specific_flags: [],
    },
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {args} = await this.parse(Learn)
    const entry = getRegistry().get(args.provider)
    if (!entry) {
      this.outputError({
        code: 'UNKNOWN_PROVIDER',
        message: `Unknown provider: ${args.provider}`,
        syntaxGuide: `Available: ${getRegistry().names().join(', ')}`,
        workingExample: '$BIN discover --json',
      })
      this.exit(2)
    }
    const {plugin, tier} = entry
    const metadata = plugin.metadata
    const resolved = credentialsFromSchema(plugin.credentials, valuesFromEnv(plugin.credentials, process.env))
    const paths = describePaths(plugin.credentials)
    const catalog = resolved ? await this.tenantCache().load(plugin.name, instanceKey(plugin.name, resolved.credentials)) : undefined
    const canonicalEntities = canonicalEntitiesFor(await this.aliasStore().sets(), plugin.name)

    const topics: Record<string, unknown> = {}
    for (const [topicName, topicMeta] of Object.entries(metadata.topics)) {
      topics[topicName] = {
        description: topicMeta.description,
        commands: topicMeta.commands,
        key_fields: topicMeta.keyFields,
        common_patterns: topicMeta.commonPatterns,
      }
    }

    this.log(JSON.stringify({
      provider: plugin.name,
      tier,
      overview: metadata.overview,
      auth_status: resolved ? `configured via ${resolved.path.description}` : 'not configured',
      auth_paths: paths,
      topics,
      query_syntax: metadata.querySyntax,
      provider_specific_flags: metadata.providerSpecificFlags,
      canonical_entities: canonicalEntities,
      ...(catalog
        ? {
            instance: {
              captured_at: catalog.capturedAt,
              entities: catalog.entities.map((e) => e.name),
              custom_entities: catalog.entities.filter((e) => e.custom).map((e) => e.name),
              bootstrap: `$BIN ${plugin.name} introspect --refresh --json`,
            },
          }
        : plugin.tenant
          ? {instance: {captured_at: null, bootstrap: `$BIN ${plugin.name} introspect --bootstrap --json`}}
          : {}),
    }, null, 2))
  }
}
