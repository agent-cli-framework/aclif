// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * CredentialSchema: declarative authentication for a provider.
 *
 * One schema per provider drives, with no provider code: the auth flags and
 * their env bindings, environment and profile resolution, the discover and
 * learn status text, --flags-for auth, and the exit 3 "no credentials"
 * error. See docs/PROVIDER_AUTHORING.md section 1.
 */
import type {ServiceAccountCredentials} from '../contract/aci.js'

export type CredentialFieldKey = Exclude<keyof ServiceAccountCredentials, 'authType'>

export interface CredentialField {
  /** Flag name without dashes, e.g. 'instance-url'. Omit for env-only fields. */
  flag?: string
  /** Environment variable, e.g. 'SF_INSTANCE_URL'. */
  env: string
  description: string
  /** Masked in output and never echoed in errors. */
  secret?: boolean
  /** Flag default, shown in --schema and applied when neither flag nor env is set. */
  default?: string
}

export interface CredentialPath {
  authType: ServiceAccountCredentials['authType']
  requires: CredentialFieldKey[]
  optional?: CredentialFieldKey[]
  /** Short human label, e.g. 'Username + password (+ security token)'. */
  description: string
}

export interface CredentialSchema {
  fields: Partial<Record<CredentialFieldKey, CredentialField>>
  /** Tried in order; the first path whose required fields are all present wins. */
  paths: CredentialPath[]
  /** Fixed values every path gets, e.g. an API host that never varies. */
  constants?: Partial<Omit<ServiceAccountCredentials, 'authType'>>
}

export type CredentialValues = Partial<Record<CredentialFieldKey, string | undefined>>

export interface ResolvedCredentials {
  credentials: ServiceAccountCredentials
  path: CredentialPath
}

function present(v: string | undefined): v is string {
  return typeof v === 'string' && v.length > 0
}

/** First satisfied path, or undefined when no path has all its required values. */
export function credentialsFromSchema(schema: CredentialSchema, values: CredentialValues): ResolvedCredentials | undefined {
  for (const path of schema.paths) {
    if (!path.requires.every((k) => present(values[k]))) continue
    const creds: Record<string, unknown> = {...(schema.constants ?? {})}
    for (const k of path.requires) creds[k] = values[k]
    for (const k of path.optional ?? []) if (present(values[k])) creds[k] = values[k]
    if (typeof creds.instanceUrl !== 'string') creds.instanceUrl = ''
    creds.authType = path.authType
    return {credentials: creds as unknown as ServiceAccountCredentials, path}
  }
  return undefined
}

export function fieldKeys(schema: CredentialSchema): CredentialFieldKey[] {
  return Object.keys(schema.fields) as CredentialFieldKey[]
}

export function valuesFromEnv(schema: CredentialSchema, env: NodeJS.ProcessEnv): CredentialValues {
  const out: CredentialValues = {}
  for (const k of fieldKeys(schema)) {
    const v = env[schema.fields[k]!.env]
    if (present(v)) out[k] = v
  }
  return out
}

/** Values from parsed oclif flags (which already carry env bindings). */
export function valuesFromFlags(schema: CredentialSchema, flags: Record<string, unknown>): CredentialValues {
  const out: CredentialValues = {}
  for (const k of fieldKeys(schema)) {
    const flag = schema.fields[k]!.flag
    if (!flag) continue
    const v = flags[flag]
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return out
}

/** Profile key for a credential field: instanceUrl → instance_url, dsAccountId → ds_account_id. */
export function profileKey(field: CredentialFieldKey): string {
  return field.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)
}

export function valuesFromProfile(schema: CredentialSchema, profile: Record<string, unknown>): CredentialValues {
  const out: CredentialValues = {}
  for (const k of fieldKeys(schema)) {
    const v = profile[profileKey(k)]
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return out
}

/** Merge sources in precedence order: the first source that has a value wins. */
export function mergeValues(...sources: CredentialValues[]): CredentialValues {
  const out: CredentialValues = {}
  for (const src of sources) {
    for (const [k, v] of Object.entries(src) as Array<[CredentialFieldKey, string | undefined]>) {
      if (present(v) && !present(out[k])) out[k] = v
    }
  }
  return out
}

/**
 * One line per path for errors and status text:
 * 'Bearer token: --instance-url + --access-token (or SN_INSTANCE_URL, SN_ACCESS_TOKEN)'.
 * Secret values never appear; only names do.
 */
export function describePaths(schema: CredentialSchema): string[] {
  return schema.paths.map((p) => {
    const flags = p.requires.map((k) => schema.fields[k]?.flag).filter(Boolean).map((f) => `--${f}`)
    const envs = p.requires.map((k) => schema.fields[k]?.env).filter(Boolean)
    const opt = (p.optional ?? []).map((k) => schema.fields[k]?.flag).filter(Boolean).map((f) => `--${f}`)
    const parts = [flags.join(' + ') || '(environment only)']
    if (opt.length) parts.push(`[${opt.join(' ')}]`)
    return `${p.description}: ${parts.join(' ')} (or ${envs.join(', ')})`
  })
}

/** Structural problems; empty when the schema is sound. */
export function validateCredentialSchema(schema: CredentialSchema): string[] {
  const errors: string[] = []
  const keys = new Set(fieldKeys(schema))
  if (keys.size === 0) errors.push('credentials.fields is empty')
  if (schema.paths.length === 0) errors.push('credentials.paths is empty')
  const flags = new Map<string, string>()
  const envs = new Map<string, string>()
  for (const k of keys) {
    const f = schema.fields[k]!
    if (f.flag) {
      if (flags.has(f.flag)) errors.push(`flag --${f.flag} declared by both ${flags.get(f.flag)} and ${k}`)
      flags.set(f.flag, k)
    }
    if (envs.has(f.env)) errors.push(`env ${f.env} declared by both ${envs.get(f.env)} and ${k}`)
    envs.set(f.env, k)
  }
  schema.paths.forEach((p, i) => {
    if (p.requires.length === 0) errors.push(`paths[${i}] requires nothing`)
    for (const k of [...p.requires, ...(p.optional ?? [])]) {
      if (!keys.has(k)) errors.push(`paths[${i}] references unknown field ${k}`)
    }
  })
  return errors
}
