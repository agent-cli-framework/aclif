// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Declarative command manifests: one operation on an instance-specific
 * endpoint (an Apex REST class, a ServiceNow scripted API, a customer
 * service) described as data and turned into a command at load time.
 * See docs/CONTRACT.md, Manifests.
 */
import {BLAST_RADII, CAPABILITIES, MUTABILITIES} from '../policy/policy.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../contract/aci.js'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export interface ManifestFlag {
  type: 'string' | 'integer' | 'boolean' | 'json'
  description: string
  required?: boolean
  options?: string[]
  default?: unknown
}

export interface CommandManifest {
  /** Full id under an existing provider namespace, e.g. 'salesforce:apex:quote-summary'. */
  id: string
  description: string
  /** Same vocabulary as static commands. Required, never inferred. */
  aciMetadata: AciMetadata
  request: {
    method: HttpMethod
    /** Path template with {flag} placeholders, resolved against the instance base URL. */
    path: string
    query?: Record<string, string>
    /** JSON template with {flag} placeholders. */
    body?: unknown
  }
  flags: Record<string, ManifestFlag>
  responseShape?: ResponseShape
  aciExamples?: CommandExample[]
}

export interface ManifestStore {
  /** Manifests for one instance. Keyed like TenantCache; the file store ignores the key until profiles model instances. */
  load(provider: string, instanceKey: string): Promise<CommandManifest[]>
}

export interface HttpRequest {
  method: HttpMethod
  path: string
  query?: Record<string, string>
  body?: unknown
}

/** An authenticated raw request against the instance, supplied by the provider plugin. */
export interface HttpAdapter {
  request(req: HttpRequest): Promise<unknown>
}

const PLACEHOLDER = /\{([a-zA-Z0-9_-]+)\}/g
const ID_RE = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$/

export function providerOf(m: CommandManifest): string {
  return m.id.split(':')[0]
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out))
}

/** Every {placeholder} used in the path, query values, and body, deduplicated. */
export function placeholdersIn(m: CommandManifest): string[] {
  const strings: string[] = [m.request.path, ...Object.values(m.request.query ?? {})]
  collectStrings(m.request.body, strings)
  const found = new Set<string>()
  for (const s of strings) for (const match of s.matchAll(PLACEHOLDER)) found.add(match[1])
  return [...found].sort()
}

/** Structural problems; empty when the manifest is sound. Mirrors schemas/manifest.schema.json. */
export function validateManifest(input: unknown): string[] {
  const errors: string[] = []
  if (!input || typeof input !== 'object') return ['manifest is not an object']
  const m = input as Record<string, unknown>
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push(`id must look like 'provider:topic:command' (got ${JSON.stringify(m.id)})`)
  if (typeof m.description !== 'string' || !m.description) errors.push('description is required')
  const meta = m.aciMetadata as Record<string, unknown> | undefined
  if (!meta || typeof meta !== 'object') errors.push('aciMetadata is required')
  else {
    if (!MUTABILITIES.includes(meta.mutability as never)) errors.push(`aciMetadata.mutability must be one of ${MUTABILITIES.join(', ')}`)
    if (!BLAST_RADII.includes(meta.blastRadius as never)) errors.push(`aciMetadata.blastRadius must be one of ${BLAST_RADII.join(', ')}`)
    for (const k of ['idempotent', 'reversible', 'requiresConfirmation']) if (typeof meta[k] !== 'boolean') errors.push(`aciMetadata.${k} must be a boolean`)
    if (typeof meta.apiCallsConsumed !== 'number') errors.push('aciMetadata.apiCallsConsumed must be a number')
    if (!Array.isArray(meta.prerequisites)) errors.push('aciMetadata.prerequisites must be an array')
    if (meta.capabilities !== undefined && (!Array.isArray(meta.capabilities) || meta.capabilities.some((c) => !CAPABILITIES.includes(c as never)))) {
      errors.push(`aciMetadata.capabilities entries must be one of ${CAPABILITIES.join(', ')}`)
    }
  }
  const req = m.request as Record<string, unknown> | undefined
  if (!req || typeof req !== 'object') errors.push('request is required')
  else {
    if (!HTTP_METHODS.includes(req.method as HttpMethod)) errors.push(`request.method must be one of ${HTTP_METHODS.join(', ')}`)
    if (typeof req.path !== 'string' || !req.path.startsWith('/')) errors.push('request.path must start with /')
    if (req.query !== undefined && (typeof req.query !== 'object' || Array.isArray(req.query) || Object.values(req.query as object).some((v) => typeof v !== 'string'))) {
      errors.push('request.query must map names to strings')
    }
  }
  const flags = m.flags as Record<string, ManifestFlag> | undefined
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) errors.push('flags must be an object (empty is fine)')
  else {
    for (const [name, f] of Object.entries(flags)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`flag '${name}' must be kebab-case`)
      if (!f || !['string', 'integer', 'boolean', 'json'].includes(f.type)) errors.push(`flag '${name}' type must be string, integer, boolean, or json`)
      if (!f || typeof f.description !== 'string') errors.push(`flag '${name}' needs a description`)
      if (f?.options && (!Array.isArray(f.options) || f.options.some((o) => typeof o !== 'string'))) errors.push(`flag '${name}' options must be strings`)
    }
  }
  if (errors.length === 0) {
    const declared = new Set(Object.keys(flags as object))
    for (const ph of placeholdersIn(input as CommandManifest)) {
      if (!declared.has(ph)) errors.push(`placeholder {${ph}} is not a declared flag`)
    }
  }
  return errors
}

function flagValue(m: CommandManifest, flags: Record<string, unknown>, name: string): unknown {
  const def = m.flags[name]
  const raw = flags[name]
  if (raw === undefined) return undefined
  if (def?.type === 'json' && typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error(`flag --${name} must be valid JSON`)
    }
  }
  return raw
}

function interpolate(template: string, m: CommandManifest, flags: Record<string, unknown>, encode: (v: string) => string): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const v = flagValue(m, flags, name)
    if (v === undefined) throw new Error(`placeholder {${name}} has no value; pass --${name}`)
    return encode(typeof v === 'string' ? v : JSON.stringify(v))
  })
}

function fillBody(value: unknown, m: CommandManifest, flags: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = value.match(/^\{([a-zA-Z0-9_-]+)\}$/)
    if (whole) return flagValue(m, flags, whole[1])   // exact placeholder keeps the flag's type (json, integer, boolean)
    return interpolate(value, m, flags, (v) => v)
  }
  if (Array.isArray(value)) return value.map((v) => fillBody(v, m, flags))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillBody(v, m, flags)]))
  }
  return value
}

/** Resolve the request template with parsed flag values. Path segments are URL-encoded; body keeps flag types. */
export function resolveRequest(m: CommandManifest, flags: Record<string, unknown>): HttpRequest {
  const req: HttpRequest = {
    method: m.request.method,
    path: interpolate(m.request.path, m, flags, encodeURIComponent),
  }
  if (m.request.query) {
    const query: Record<string, string> = {}
    for (const [k, v] of Object.entries(m.request.query)) {
      const needed = [...v.matchAll(PLACEHOLDER)].map((x) => x[1])
      if (needed.length && needed.every((n) => flagValue(m, flags, n) === undefined)) continue   // optional query params drop out when unset
      query[k] = interpolate(v, m, flags, (s) => s)
    }
    if (Object.keys(query).length) req.query = query
  }
  if (m.request.body !== undefined) req.body = fillBody(m.request.body, m, flags)
  return req
}
