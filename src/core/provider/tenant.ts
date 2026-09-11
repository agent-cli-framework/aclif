// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Tenant knowledge: what one live instance has that the platform does not
 * (custom objects, custom fields, enumerations, relationships, permissions).
 * Captured by an explicit bootstrap against live credentials, cached per
 * instance key, never fetched as a side effect of another command.
 * See docs/CONTRACT.md, Tenant catalogue.
 */
import {createHash} from 'node:crypto'

import type {ServiceAccountCredentials} from '../contract/aci.js'

export type TenantProvenance = 'metadata' | 'sample-inference' | 'probe'

export interface TenantField {
  name: string
  label: string
  type: string
  /** Enumerated values, when the field has a fixed set. */
  enum?: string[]
  /** Entity names this field references. */
  references?: string[]
  custom: boolean
}

export interface TenantEntity {
  name: string
  label: string
  custom: boolean
  fields: TenantField[]
  provenance: TenantProvenance
}

export interface TenantPermissions {
  read: boolean
  create: boolean
  update: boolean
  delete: boolean
}

export interface TenantCatalog {
  provider: string
  capturedAt: string
  apiVersion?: string
  /** Who captured it; never a secret. */
  identity?: string
  entities: TenantEntity[]
  permissions: Record<string, TenantPermissions> | null
}

export interface TenantWalkOptions {
  /** Widen beyond custom entities plus the provider's coreEntities. */
  all?: boolean
  /** Restrict to these entities. */
  entities?: string[]
}

export interface TenantCache {
  load(provider: string, instanceKey: string): Promise<TenantCatalog | undefined>
  save(provider: string, instanceKey: string, catalog: TenantCatalog): Promise<void>
}

/** A tenant walk a provider plugin can offer. Read-only by contract (C-TEN-1). */
export interface TenantWalk<TClient = unknown> {
  buildCatalog(client: TClient, opts?: TenantWalkOptions): Promise<TenantCatalog>
  /** Entities always included in the default (narrow) walk. */
  coreEntities?: string[]
}

/**
 * The key both the connection pool and the tenant cache use, so a
 * catalogue can never be served for a different tenant than the
 * connection it came from. Includes the provider so equal instance URLs on
 * different providers do not collide, and the identity so two users of
 * one org are kept apart.
 */
export function instanceKey(provider: string, creds: ServiceAccountCredentials): string {
  const identity = creds.username ?? creds.delegatedUser ?? creds.impersonatedUserId ?? creds.clientId ?? ''
  const raw = `${provider}:${creds.instanceUrl}:${identity}:${creds.authType}`
  return createHash('sha256').update(raw).digest('hex')
}

/** Structural problems; empty when the catalogue is sound. Mirrors schemas/tenant-catalog.schema.json. */
export function validateTenantCatalog(c: unknown): string[] {
  const errors: string[] = []
  if (!c || typeof c !== 'object') return ['catalog is not an object']
  const cat = c as Record<string, unknown>
  if (typeof cat.provider !== 'string' || !cat.provider) errors.push('provider missing')
  if (typeof cat.capturedAt !== 'string' || Number.isNaN(Date.parse(cat.capturedAt))) errors.push('capturedAt is not an ISO date')
  if (!Array.isArray(cat.entities)) errors.push('entities is not an array')
  else {
    cat.entities.forEach((e, i) => {
      const ent = e as Record<string, unknown>
      if (typeof ent.name !== 'string' || !ent.name) errors.push(`entities[${i}].name missing`)
      if (!['metadata', 'sample-inference', 'probe'].includes(ent.provenance as string)) errors.push(`entities[${i}].provenance invalid`)
      if (!Array.isArray(ent.fields)) errors.push(`entities[${i}].fields is not an array`)
      else {
        ;(ent.fields as unknown[]).forEach((f, j) => {
          const fld = f as Record<string, unknown>
          if (typeof fld.name !== 'string') errors.push(`entities[${i}].fields[${j}].name missing`)
          if (typeof fld.type !== 'string') errors.push(`entities[${i}].fields[${j}].type missing`)
          for (const k of Object.keys(fld)) {
            if (!['name', 'label', 'type', 'enum', 'references', 'custom'].includes(k)) errors.push(`entities[${i}].fields[${j}] has unexpected key '${k}' (field values are never stored)`)
          }
        })
      }
    })
  }
  if (cat.permissions !== null && (typeof cat.permissions !== 'object')) errors.push('permissions must be an object or null')
  return errors
}

/** Closest entity name for a typo, by case-insensitive containment then edit distance. */
export function closestEntity(catalog: TenantCatalog, name: string): string | undefined {
  const names = catalog.entities.map((e) => e.name)
  const lower = name.toLowerCase()
  const contained = names.find((n) => n.toLowerCase() === lower) ?? names.find((n) => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()))
  if (contained) return contained
  let best: {name: string; d: number} | undefined
  for (const n of names) {
    const d = editDistance(lower, n.toLowerCase())
    if (!best || d < best.d) best = {name: n, d}
  }
  return best && best.d <= Math.max(3, Math.floor(name.length / 3)) ? best.name : undefined
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({length: a.length + 1}, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}
