// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * CredentialResolver: typed credential lookup for commands.
 *
 * Hosts pick the resolver for their environment:
 *   EnvCredentialResolver      environment variables, by each provider's schema
 *   ProfileCredentialResolver  one config.yaml profile, by schema
 *   StaticCredentialResolver   a fixed map (tests, pre-resolved hosts)
 *   ChainCredentialResolver    first resolver with an answer wins
 * The gateway supplies its own vault-backed resolver on the Invocation.
 */
import {credentialsFromSchema, valuesFromEnv, valuesFromProfile} from '../provider/credential-schema.js'
import type {ProviderRegistry} from '../provider/registry.js'
import type {ServiceAccountCredentials} from '../contract/aci.js'

export interface CredentialResolver {
  /** Credentials for a provider, or undefined when none are configured. */
  get(provider: string): Promise<ServiceAccountCredentials | undefined>
}

export class EnvCredentialResolver implements CredentialResolver {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async get(provider: string): Promise<ServiceAccountCredentials | undefined> {
    const plugin = this.registry.plugin(provider)
    if (!plugin) return undefined
    return credentialsFromSchema(plugin.credentials, valuesFromEnv(plugin.credentials, this.env))?.credentials
  }
}

export class ProfileCredentialResolver implements CredentialResolver {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly profile: Record<string, Record<string, unknown> | undefined>,
  ) {}

  async get(provider: string): Promise<ServiceAccountCredentials | undefined> {
    const plugin = this.registry.plugin(provider)
    const section = this.profile[provider]
    if (!plugin || !section) return undefined
    return credentialsFromSchema(plugin.credentials, valuesFromProfile(plugin.credentials, section))?.credentials
  }
}

export class StaticCredentialResolver implements CredentialResolver {
  constructor(private readonly creds: Map<string, ServiceAccountCredentials>) {}

  async get(provider: string): Promise<ServiceAccountCredentials | undefined> {
    return this.creds.get(provider)
  }
}

export class ChainCredentialResolver implements CredentialResolver {
  constructor(private readonly resolvers: CredentialResolver[]) {}

  async get(provider: string): Promise<ServiceAccountCredentials | undefined> {
    for (const r of this.resolvers) {
      const creds = await r.get(provider)
      if (creds) return creds
    }
    return undefined
  }
}
