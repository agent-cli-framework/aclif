import {Ajv2020 as Ajv} from 'ajv/dist/2020.js'
import {readFile} from 'node:fs/promises'
import {beforeAll, describe, expect, it} from 'vitest'

import {STARTER_VOCABULARY} from '../../src/cli/config/alias-store.js'
import {AliasResolver, canonicalEntitiesFor, invert, nearestCanonical, projectRecord, validateAliasSet, type AliasSet} from '../../src/core/alias/alias-set.js'
import {getRegistry} from '../../src/providers/index.js'
import {ConnectionPool} from '../../src/core/runtime/connection-pool.js'
import {StaticCredentialResolver} from '../../src/core/runtime/credential-resolver.js'
import {EventReporter} from '../../src/core/output/reporter.js'
import {Runtime} from '../../src/core/runtime/runtime.js'

let fixture: AliasSet
beforeAll(async () => {
  fixture = JSON.parse(await readFile('test/fixtures/aliases/two-instance.json', 'utf8'))
})

describe('C-ALIAS-1 alias set shape', () => {
  it('the starter vocabulary and the fixture validate against the schema and the validator, and map only registered providers', async () => {
    const validate = new Ajv({strict: false}).compile(JSON.parse(await readFile('schemas/alias-set.schema.json', 'utf8')))
    const known = new Set(getRegistry().names())
    for (const set of [STARTER_VOCABULARY, fixture]) {
      expect(validate(set), JSON.stringify(validate.errors)).toBe(true)
      expect(validateAliasSet(set)).toEqual([])
      for (const e of set.entities) for (const m of [...e.mappings, ...e.fields.flatMap((f) => f.mappings)]) expect(known.has(m.provider), m.provider).toBe(true)
    }
    expect(STARTER_VOCABULARY.entities.map((e) => e.canonical)).toContain('customer')
  })

  it('rejects repeated names, empty mappings, and natural keys naming unknown fields', () => {
    const bad = JSON.parse(JSON.stringify(fixture)) as AliasSet
    bad.entities[1].canonical = 'customer'
    bad.entities[0].mappings = []
    bad.entities[0].naturalKey = ['nope']
    const errors = validateAliasSet(bad)
    expect(errors.some((e) => e.includes("'customer' repeats"))).toBe(true)
    expect(errors.some((e) => e.includes('non-empty'))).toBe(true)
    expect(errors.some((e) => e.includes("unknown field 'nope'"))).toBe(true)
    expect(validateAliasSet({...fixture, entities: [{...fixture.entities[0], canonical: 'Bad Name'}]})[0]).toMatch(/snake_case/)
  })
})

describe('U-ALIAS-1 resolver', () => {
  const resolver = () => new AliasResolver(async () => [fixture, STARTER_VOCABULARY])

  it('resolves per provider and instance with the field map for that instance', async () => {
    const primary = await resolver().resolveEntity('customer', 'salesforce', 'primary')
    expect(primary).toEqual({canonical: 'customer', native: 'Account', fieldMap: {name: 'Name', primary_domain: 'Website'}, set: 'two-instance-fixture'})
    const acquired = await resolver().resolveEntity('customer', 'salesforce', 'acquired')
    expect(acquired?.fieldMap).toEqual({name: 'Name', region: 'Region__c'})
  })

  it("wildcard instance mappings match any instance, and '*' as the asked instance matches anything", async () => {
    expect((await resolver().resolveEntity('ticket', 'servicenow', 'anything'))?.native).toBe('incident')
    expect((await resolver().resolveEntity('customer', 'servicenow', '*'))?.native).toBe('core_company')
    expect((await resolver().resolveEntity('customer', 'servicenow', 'other'))?.set).toBe('starter-vocabulary')
    expect(await new AliasResolver(async () => [fixture]).resolveEntity('customer', 'servicenow', 'other')).toBeUndefined()
    expect(await resolver().resolveEntity('customer', 'docusign', '*')).toBeUndefined()
  })

  it('the first set wins, then falls through to later sets', async () => {
    expect((await resolver().resolveEntity('customer', 'salesforce', 'primary'))?.set).toBe('two-instance-fixture')
    expect((await resolver().resolveEntity('opportunity', 'salesforce', 'primary'))?.set).toBe('starter-vocabulary')
  })

  it('reverse lookup, entity listing, suggestions, projection, inversion', async () => {
    expect(await resolver().reverse('servicenow', 'primary', 'core_company')).toEqual({canonical: 'customer', fieldMap: {name: 'name', website: 'primary_domain'}, set: 'two-instance-fixture'})
    expect(canonicalEntitiesFor([fixture], 'salesforce')).toEqual(['customer'])
    expect(canonicalEntitiesFor([fixture], 'servicenow', 'other')).toEqual(['ticket'])
    expect(nearestCanonical([fixture], 'custmer')).toEqual(['customer'])
    expect(nearestCanonical([fixture], 'zzzzzzzz')).toEqual([])
    expect(projectRecord({name: 'Acme', website: 'acme.com', sys_id: '1'}, {name: 'name', website: 'primary_domain'})).toEqual({name: 'Acme', primary_domain: 'acme.com', sys_id: '1'})
    expect(invert({a: 'x', b: 'y'})).toEqual({x: 'a', y: 'b'})
  })
})

describe('U-ALIAS-2 --canonical through the runtime', () => {
  it('rewrites the table and fields, projects records back, and reports the resolution in _context', async () => {
    const runtime = await Runtime.start({cliRoot: process.cwd()})
    try {
      const calls: unknown[] = []
      const pool = new ConnectionPool()
      pool.registerFactory('servicenow', {
        create: async () => ({
          tableQuery: async (table: string, params: unknown) => (calls.push([table, params]), {result: [{name: 'Acme', website: 'acme.com', sys_id: '1'}], totalCount: 1}),
        }),
      })
      const base = {
        context: {requestId: 'r'},
        credentials: new StaticCredentialResolver(new Map([['servicenow', {instanceUrl: 'https://sn', accessToken: 't', authType: 'session' as const}]])),
        pool,
        aliasStore: new AliasResolver(async () => [fixture]),
      }
      const ok = await runtime.run({...base, argv: ['servicenow', 'data', 'query', '--table', 'customer', '--fields', 'name,primary_domain', '--canonical', '--instance', 'primary'], reporter: new EventReporter()})
      expect(ok.exitCode, JSON.stringify(ok.envelope)).toBe(0)
      expect(calls[0]).toMatchObject(['core_company', {sysparm_fields: 'name,website'}])
      const env = ok.envelope as unknown as {result: {table: string; records: Array<Record<string, unknown>>}; _context: {canonical: unknown}}
      expect(env.result.table).toBe('core_company')
      // projected to canonical names, then narrowed by the command's own --fields filter
      expect(env.result.records[0]).toEqual({name: 'Acme', primary_domain: 'acme.com'})
      expect(env._context.canonical).toEqual({set: 'two-instance-fixture', entity: 'customer', native: 'core_company', instance: 'primary'})

      const unknown = await runtime.run({...base, argv: ['servicenow', 'data', 'query', '--table', 'custmer', '--canonical', '--instance', 'primary'], reporter: new EventReporter()})
      expect(unknown.exitCode).toBe(2)
      expect(unknown.envelope.error).toMatchObject({code: 'CANONICAL_NOT_FOUND', syntaxGuide: 'Nearest canonical names: customer'})

      const badField = await runtime.run({...base, argv: ['servicenow', 'data', 'query', '--table', 'customer', '--fields', 'name,colour', '--canonical', '--instance', 'primary'], reporter: new EventReporter()})
      expect(badField.exitCode).toBe(2)
      expect(badField.envelope.error?.code).toBe('CANONICAL_FIELD_NOT_FOUND')
    } finally {
      runtime.stop()
    }
  })
})
