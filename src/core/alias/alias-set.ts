// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Canonical names: one vocabulary over many providers and instances.
 * Resolution is a lookup and lives here; generation (comparing two
 * instances' catalogs) stays outside the CLI. See
 * docs/CONTRACT.md, Alias sets.
 */

/** instance '*' means any instance of the provider. */
export interface AliasMapping {
  provider: string
  instance: string
  native: string
}

export interface AliasField {
  canonical: string
  label?: string
  type?: string
  description?: string
  mappings: AliasMapping[]
}

export interface AliasEntity {
  canonical: string
  label?: string
  description?: string
  /** Canonical field names that identify a record across systems. */
  naturalKey?: string[]
  mappings: AliasMapping[]
  fields: AliasField[]
}

export interface AliasSet {
  id: string
  name: string
  capturedAt: string
  description?: string
  entities: AliasEntity[]
}

export interface ResolvedEntity {
  canonical: string
  native: string
  /** canonical field → native field, for the resolved provider and instance. */
  fieldMap: Record<string, string>
  set: string
}

export interface ReverseEntity {
  canonical: string
  /** native field → canonical field. */
  fieldMap: Record<string, string>
  set: string
}

export interface AliasStore {
  /** Active sets in precedence order; first match wins. */
  sets(): Promise<AliasSet[]>
  resolveEntity(canonical: string, provider: string, instance: string): Promise<ResolvedEntity | undefined>
  reverse(provider: string, instance: string, native: string): Promise<ReverseEntity | undefined>
}

const NAME_RE = /^[a-z][a-z0-9_]*$/

export function validateAliasSet(input: unknown): string[] {
  const errors: string[] = []
  if (!input || typeof input !== 'object') return ['alias set is not an object']
  const s = input as Record<string, unknown>
  for (const k of ['id', 'name']) if (typeof s[k] !== 'string' || !s[k]) errors.push(`${k} is required`)
  if (typeof s.capturedAt !== 'string' || Number.isNaN(Date.parse(s.capturedAt))) errors.push('capturedAt is not an ISO date')
  if (!Array.isArray(s.entities)) return [...errors, 'entities is not an array']
  const seen = new Set<string>()
  s.entities.forEach((e, i) => {
    const ent = e as Record<string, unknown>
    const where = `entities[${i}]`
    if (typeof ent.canonical !== 'string' || !NAME_RE.test(ent.canonical)) errors.push(`${where}.canonical must be snake_case`)
    else if (seen.has(ent.canonical)) errors.push(`${where}.canonical '${ent.canonical}' repeats`)
    else seen.add(ent.canonical)
    if (!Array.isArray(ent.mappings) || ent.mappings.length === 0) errors.push(`${where}.mappings must be a non-empty array`)
    else ent.mappings.forEach((m, j) => errors.push(...validateMapping(m, `${where}.mappings[${j}]`)))
    if (ent.naturalKey !== undefined && (!Array.isArray(ent.naturalKey) || ent.naturalKey.some((k) => typeof k !== 'string'))) errors.push(`${where}.naturalKey must be a list of strings`)
    if (!Array.isArray(ent.fields)) errors.push(`${where}.fields is not an array`)
    else {
      const fseen = new Set<string>()
      ;(ent.fields as unknown[]).forEach((f, j) => {
        const fld = f as Record<string, unknown>
        const fw = `${where}.fields[${j}]`
        if (typeof fld.canonical !== 'string' || !NAME_RE.test(fld.canonical)) errors.push(`${fw}.canonical must be snake_case`)
        else if (fseen.has(fld.canonical)) errors.push(`${fw}.canonical '${fld.canonical}' repeats`)
        else fseen.add(fld.canonical)
        if (!Array.isArray(fld.mappings)) errors.push(`${fw}.mappings is not an array`)
        else fld.mappings.forEach((m, k) => errors.push(...validateMapping(m, `${fw}.mappings[${k}]`)))
      })
      const keys = (ent.naturalKey as string[] | undefined) ?? []
      for (const k of keys) if (!fseen.has(k)) errors.push(`${where}.naturalKey names unknown field '${k}'`)
    }
  })
  return errors
}

function validateMapping(m: unknown, where: string): string[] {
  const out: string[] = []
  const map = m as Record<string, unknown>
  if (!map || typeof map !== 'object') return [`${where} is not an object`]
  for (const k of ['provider', 'instance', 'native']) if (typeof map[k] !== 'string' || !map[k]) out.push(`${where}.${k} is required`)
  return out
}

export function matchesInstance(m: AliasMapping, provider: string, instance: string): boolean {
  return m.provider === provider && (m.instance === '*' || instance === '*' || m.instance === instance)
}

/** In-memory resolution over an ordered list of sets. */
export class AliasResolver implements AliasStore {
  constructor(private readonly loadSets: () => Promise<AliasSet[]>) {}

  sets(): Promise<AliasSet[]> {
    return this.loadSets()
  }

  async resolveEntity(canonical: string, provider: string, instance: string): Promise<ResolvedEntity | undefined> {
    for (const set of await this.loadSets()) {
      const entity = set.entities.find((e) => e.canonical === canonical)
      if (!entity) continue
      const mapping = entity.mappings.find((m) => matchesInstance(m, provider, instance))
      if (!mapping) continue
      const fieldMap: Record<string, string> = {}
      for (const f of entity.fields) {
        const fm = f.mappings.find((m) => matchesInstance(m, provider, instance))
        if (fm) fieldMap[f.canonical] = fm.native
      }
      return {canonical, native: mapping.native, fieldMap, set: set.id}
    }
    return undefined
  }

  async reverse(provider: string, instance: string, native: string): Promise<ReverseEntity | undefined> {
    for (const set of await this.loadSets()) {
      for (const entity of set.entities) {
        if (!entity.mappings.some((m) => matchesInstance(m, provider, instance) && m.native === native)) continue
        const fieldMap: Record<string, string> = {}
        for (const f of entity.fields) {
          const fm = f.mappings.find((m) => matchesInstance(m, provider, instance))
          if (fm) fieldMap[fm.native] = f.canonical
        }
        return {canonical: entity.canonical, fieldMap, set: set.id}
      }
    }
    return undefined
  }
}

/** Canonical entity names that have a mapping for the provider, across all sets, deduplicated. */
export function canonicalEntitiesFor(sets: AliasSet[], provider: string, instance = '*'): string[] {
  const out = new Set<string>()
  for (const set of sets) for (const e of set.entities) if (e.mappings.some((m) => matchesInstance(m, provider, instance))) out.add(e.canonical)
  return [...out].sort()
}

/** Suggestions for a name that did not resolve: containment first, then short edit distance. */
export function nearestCanonical(sets: AliasSet[], name: string, limit = 5): string[] {
  const names = new Set<string>()
  for (const set of sets) for (const e of set.entities) names.add(e.canonical)
  const lower = name.toLowerCase()
  const scored = [...names].map((n) => ({n, score: n.includes(lower) || lower.includes(n) ? 0 : editDistance(lower, n)}))
  return scored
    .filter((s) => s.score <= Math.max(3, Math.floor(lower.length / 2)))
    .sort((a, b) => a.score - b.score || a.n.localeCompare(b.n))
    .slice(0, limit)
    .map((s) => s.n)
}

/** Rename record keys native → canonical; unmapped keys pass through unchanged. */
export function projectRecord<T extends Record<string, unknown>>(record: T, nativeToCanonical: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) out[nativeToCanonical[k] ?? k] = v
  return out
}

/** Invert canonical → native into native → canonical. */
export function invert(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]))
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
