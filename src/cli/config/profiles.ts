// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * config.yaml: profiles, policy, identity provider.
 *
 * Location: <configDir>/config.yaml, where configDir is oclif's
 * XDG-derived directory. Resolution precedence for credentials is flags,
 * then environment variables, then the selected profile.
 *
 * Profile keys are the snake_case form of each provider's credential
 * fields (instanceUrl → instance_url), derived from its CredentialSchema.
 */
import {readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import yaml from 'js-yaml'

import {
  BLAST_RADII,
  CONFIRM_TRIGGERS,
  DEFAULT_POLICY,
  type Policy,
} from '../../core/policy/policy.js'
import {IDENTITY_PROVIDER_NAMES} from '../../core/identity/index.js'
import {fieldKeys, profileKey, type CredentialSchema} from '../../core/provider/credential-schema.js'
import {isSecretSourceObject, resolveSecretSource, type SecretSource} from '../../core/credentials/secret-source.js'

export const CONFIG_FILE = 'config.yaml'

export type ProviderProfile = Record<string, SecretSource | undefined>
export type Profile = Record<string, ProviderProfile>

export interface ConfigFile {
  default_profile?: string
  profiles?: Record<string, Profile>
  policy?: Partial<Policy>
  identity?: {provider?: string}
  /** profile → provider → manifest files; see cli/config/manifest-store.ts */
  manifests?: Record<string, Record<string, string[]>>
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface LoadedConfig {
  file: string
  exists: boolean
  config: ConfigFile
  warnings: string[]
  /** File mode bits when the file exists (for the permission warning). */
  mode?: number
}

export function loadConfigFile(configDir: string): LoadedConfig {
  const file = join(configDir, CONFIG_FILE)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return {file, exists: false, config: {}, warnings: []}
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    throw new ConfigError(`${file}: ${(err as Error).message}`)
  }
  let mode: number | undefined
  try {
    mode = statSync(file).mode & 0o777
  } catch {
    /* mode stays unknown */
  }
  if (parsed === null || parsed === undefined) return {file, exists: true, config: {}, warnings: [], mode}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new ConfigError(`${file}: top level must be a mapping`)
  const config = parsed as ConfigFile
  const warnings: string[] = []
  if (config.identity?.provider && !(IDENTITY_PROVIDER_NAMES as readonly string[]).includes(config.identity.provider)) {
    throw new ConfigError(
      `${file}: identity.provider '${config.identity.provider}' is not one of ${IDENTITY_PROVIDER_NAMES.join(', ')}`,
    )
  }
  return {file, exists: true, config, warnings, mode}
}

/**
 * Pick a profile. A named profile that does not exist is an error; no name
 * and no default_profile yields undefined.
 */
export function selectProfile(loaded: LoadedConfig, name?: string): {name: string; profile: Profile} | undefined {
  const wanted = name ?? loaded.config.default_profile
  if (!wanted) return undefined
  const profiles = loaded.config.profiles ?? {}
  const profile = profiles[wanted]
  if (!profile) {
    const available = Object.keys(profiles)
    const hint = available.length ? `available: ${available.join(', ')}` : 'the file defines no profiles'
    throw new ConfigError(`Profile '${wanted}' not found in ${loaded.file}; ${hint}`)
  }
  return {name: wanted, profile}
}

export function resolvePolicy(section: unknown, file = CONFIG_FILE): Policy {
  if (section === undefined || section === null) return {...DEFAULT_POLICY}
  if (typeof section !== 'object' || Array.isArray(section)) throw new ConfigError(`${file}: policy must be a mapping`)
  const s = section as Record<string, unknown>
  const policy: Policy = {...DEFAULT_POLICY}
  if (s.require_identity !== undefined) {
    if (typeof s.require_identity !== 'boolean') throw new ConfigError(`${file}: policy.require_identity must be true or false`)
    policy.require_identity = s.require_identity
  }
  if (s.require_confirm_for !== undefined) {
    policy.require_confirm_for = stringList(s.require_confirm_for, 'policy.require_confirm_for', CONFIRM_TRIGGERS, file) as Policy['require_confirm_for']
  }
  if (s.dry_run_warning_for !== undefined) {
    policy.dry_run_warning_for = stringList(s.dry_run_warning_for, 'policy.dry_run_warning_for', BLAST_RADII, file) as Policy['dry_run_warning_for']
  }
  return policy
}

function stringList(value: unknown, key: string, allowed: readonly string[], file: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ConfigError(`${file}: ${key} must be a list of strings`)
  }
  for (const v of value as string[]) {
    if (!allowed.includes(v)) throw new ConfigError(`${file}: ${key} contains '${v}'; allowed: ${allowed.join(', ')}`)
  }
  return value as string[]
}

/**
 * Set environment defaults from a profile without overriding values already
 * present, preserving flag > env > profile precedence. `schemas` maps
 * provider name to its credential schema (from the registry). Returns
 * warnings for keys that could not be applied.
 */
export interface ApplyProfileOptions {
  /** Mode bits of the config file; a literal secret in a group- or world-readable file warns once. */
  fileMode?: number
  /** Directory {file} sources resolve against (the config directory). */
  cwd?: string
}

export function applyProfileToEnv(
  profileName: string,
  profile: Profile,
  schemas: Record<string, CredentialSchema>,
  env: NodeJS.ProcessEnv = process.env,
  opts: ApplyProfileOptions = {},
): string[] {
  const warnings: string[] = []
  let warnedReadable = false
  for (const [providerName, fields] of Object.entries(profile)) {
    const schema = schemas[providerName]
    if (!schema) {
      warnings.push(`Profile '${profileName}': unknown provider '${providerName}' ignored`)
      continue
    }
    if (!fields || typeof fields !== 'object') continue
    const byKey = new Map(fieldKeys(schema).map((k) => [profileKey(k), schema.fields[k]!]))
    for (const [field, value] of Object.entries(fields)) {
      const def = byKey.get(field)
      if (!def) {
        warnings.push(`Profile '${profileName}': unknown field '${field}' for '${providerName}' ignored`)
        continue
      }
      if (value === undefined || value === null || value === '') continue
      if (typeof value !== 'string' && !isSecretSourceObject(value)) {
        warnings.push(`Profile '${profileName}': ${providerName}.${field} must be a string or one of {env}, {file}, {exec}; ignored`)
        continue
      }
      if (def.secret && typeof value === 'string' && opts.fileMode !== undefined && (opts.fileMode & 0o077) !== 0 && !warnedReadable) {
        warnings.push(`Config file is readable by others (mode ${opts.fileMode.toString(8)}) and holds a literal secret (${providerName}.${field}); chmod 600 it or use {env}, {file}, or {exec}`)
        warnedReadable = true
      }
      if (env[def.env]) continue
      try {
        env[def.env] = resolveSecretSource(value, {env, cwd: opts.cwd})
      } catch (err) {
        warnings.push(`Profile '${profileName}': ${providerName}.${field}: ${(err as Error).message}`)
      }
    }
  }
  return warnings
}
