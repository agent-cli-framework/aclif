import {Ajv2020 as Ajv} from 'ajv/dist/2020.js'
import {Config} from '@oclif/core'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import {fieldKeys} from '../../src/core/provider/credential-schema.js'
import type {ProviderPlugin} from '../../src/core/provider/plugin.js'
import {validateTenantCatalog, type TenantCatalog} from '../../src/core/provider/tenant.js'
import {manifestCommand} from '../../src/core/manifest/manifest-command.js'
import type {CommandManifest} from '../../src/core/manifest/manifest.js'
import {resetProcessPool} from '../../src/core/runtime/process-pool.js'
import {builtinRegistry} from '../../src/providers/index.js'
import {json, runClass} from '../helpers/run-class.js'

/**
 * Conformance for the optional plugin surfaces, each driven through a
 * recording fake so no network is involved: C-TEN-1, C-TEN-2, C-TEN-3 for
 * tenant walks; C-MAN-3 for http adapters; C-SEC-2 for session support.
 * A provider that adds one of these surfaces needs a fake here, and the
 * test says so.
 */
const registry = builtinRegistry()
const entries = registry.entries()

/** Wrap an implementation so every member access is recorded and anything undeclared throws. */
function recording<T extends object>(impl: T): {client: T; calls: string[]} {
  const calls: string[] = []
  const client = new Proxy(impl, {
    get(t, p) {
      if (p === 'then') return undefined
      if (!(p in t)) throw new Error(`fake client has no member '${String(p)}'`)
      calls.push(String(p))
      const v = Reflect.get(t, p)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
  return {client, calls}
}

const sfField = (name: string, custom = false) => ({name, label: name, type: 'string', length: 0, nillable: true, createable: true, updateable: true, defaultValue: null, picklistValues: [], referenceTo: [], relationshipName: null, externalId: false, unique: false, calculated: false, custom})

function salesforceFake() {
  const described: string[] = []
  const impl = {
    version: '59.0',
    userInfo: undefined,
    async describeGlobal() {
      return {sobjects: [
        {name: 'Account', custom: false, queryable: true},
        {name: 'Contact', custom: false, queryable: true},
        {name: 'Task', custom: false, queryable: true},
        {name: 'Warranty__c', custom: true, queryable: true},
        {name: 'Hidden__c', custom: true, queryable: false},
      ]}
    },
    async describe(name: string) {
      described.push(name)
      return {name, label: name, labelPlural: name, keyPrefix: '001', queryable: true, createable: true, updateable: true, deletable: true, fields: [sfField('Id'), sfField('Tier__c', true)], childRelationships: []}
    },
  }
  return {...recording(impl), described}
}

function servicenowFake() {
  const queries: string[] = []
  const described: string[] = []
  const impl = {
    instanceUrl: 'https://example.invalid',
    async listTables(query?: string) {
      queries.push(query ?? '')
      return {result: [{name: 'incident'}, {name: 'u_custom'}]}
    },
    async getTableHierarchy(t: string) {
      return [t]
    },
    async describeTable(t: string) {
      described.push(t)
      return {result: [{element: 'number', column_label: 'Number', internal_type: 'string', max_length: '40', mandatory: 'false', read_only: 'false', choice: '0'}]}
    },
    async getChoices() {
      return {result: []}
    },
  }
  return {...recording(impl), queries, described}
}

const TENANT_FAKES: Record<string, () => {client: unknown; calls: string[]}> = {salesforce: salesforceFake, servicenow: servicenowFake}
const READ_ONLY_MEMBERS: Record<string, string[]> = {
  salesforce: ['describeGlobal', 'describe', 'userInfo', 'version'],
  servicenow: ['listTables', 'getTableHierarchy', 'describeTable', 'getChoices', 'instanceUrl'],
}

let catalogSchema: (c: unknown) => boolean
let ajv: Ajv
beforeAll(async () => {
  ajv = new Ajv({allErrors: true, strict: false})
  catalogSchema = ajv.compile(JSON.parse(await readFile('schemas/tenant-catalog.schema.json', 'utf8')) as object)
})

describe('C-TEN-1, C-TEN-2, C-TEN-3 tenant walks', () => {
  const withTenant = entries.filter(({plugin}) => plugin.tenant)

  it('every tenant provider has a recording fake in this suite and an introspect command with --bootstrap, --refresh, --all', () => {
    for (const {plugin} of withTenant) {
      expect(TENANT_FAKES[plugin.name], `add a recording fake for ${plugin.name} to test/conformance/tenant.test.ts`).toBeDefined()
      const introspect = plugin.commands[`${plugin.name}:introspect`] as unknown as {flags: Record<string, unknown>}
      expect(introspect, `${plugin.name}:introspect`).toBeDefined()
      for (const f of ['bootstrap', 'refresh', 'all']) expect(introspect.flags, `${plugin.name}:introspect --${f}`).toHaveProperty(f)
    }
  })

  it.each(withTenant.map((e) => [e.plugin.name, e.plugin]))('%s: buildCatalog reads only, and its output validates with provenance on every entity', async (_name, p) => {
    const plugin = p as ProviderPlugin
    const fake = TENANT_FAKES[plugin.name]()
    const catalog = await plugin.tenant!.buildCatalog(fake.client, {})
    expect([...new Set(fake.calls)].filter((c) => !READ_ONLY_MEMBERS[plugin.name].includes(c)), 'members used beyond the read-only set').toEqual([])
    expect(validateTenantCatalog(catalog)).toEqual([])
    expect(catalogSchema(catalog), ajv.errorsText((catalogSchema as unknown as {errors: unknown[]}).errors as never)).toBe(true)
    expect(catalog.provider).toBe(plugin.name)
    for (const e of catalog.entities) {
      expect(e.provenance, e.name).toBeDefined()
      for (const f of e.fields) expect(Object.keys(f).sort(), `${e.name}.${f.name} carries only shape, never values`).toEqual(Object.keys(f).filter((k) => ['name', 'label', 'type', 'custom', 'enum', 'references', 'required'].includes(k)).sort())
    }
  })

  it('Salesforce: the default walk describes custom objects plus the core standard objects; --all widens; entities restrict', async () => {
    const plugin = registry.plugin('salesforce')!
    const byDefault = salesforceFake()
    const cat = await plugin.tenant!.buildCatalog(byDefault.client, {})
    expect(byDefault.described.sort()).toEqual(['Account', 'Contact', 'Warranty__c'])
    expect(cat.entities.map((e) => e.name)).toEqual(['Account', 'Contact', 'Warranty__c'])
    const all = salesforceFake()
    await plugin.tenant!.buildCatalog(all.client, {all: true})
    expect(all.described.sort()).toEqual(['Account', 'Contact', 'Task', 'Warranty__c'])
    const one = salesforceFake()
    await plugin.tenant!.buildCatalog(one.client, {entities: ['Task', 'Hidden__c']})
    expect(one.described).toEqual(['Task'])
  })

  it('ServiceNow: the default walk asks for the core tables plus u_ and x_ tables; --all asks for everything; entities skip the listing', async () => {
    const plugin = registry.plugin('servicenow')!
    const byDefault = servicenowFake()
    const cat = await plugin.tenant!.buildCatalog(byDefault.client, {})
    expect(byDefault.queries).toHaveLength(1)
    expect(byDefault.queries[0]).toMatch(/^nameIN.*incident.*\^ORnameSTARTSWITHu_\^ORnameSTARTSWITHx_$/)
    expect(cat.entities.map((e) => [e.name, e.custom])).toEqual([['incident', false], ['u_custom', true]])
    const all = servicenowFake()
    await plugin.tenant!.buildCatalog(all.client, {all: true})
    expect(all.queries).toEqual(['sys_update_nameISNOTEMPTY'])
    const one = servicenowFake()
    await plugin.tenant!.buildCatalog(one.client, {entities: ['incident']})
    expect(one.queries).toEqual([])
    expect(one.described).toEqual(['incident'])
  })
})

describe('C-MAN-3 http adapters', () => {
  const withHttp = entries.filter(({plugin}) => plugin.http)
  let config: Config
  let home: string
  const saved: Record<string, string | undefined> = {}
  const originalCreate = new Map<string, ProviderPlugin['createClient']>()

  function httpFake(name: string): {client: Record<string, unknown>; requests: unknown[][]} {
    const requests: unknown[][] = []
    const record = async (...args: unknown[]) => {
      requests.push(args)
      return {ok: true, args}
    }
    const client: Record<string, unknown> = name === 'salesforce'
      ? {accessToken: 'tok', instanceUrl: 'https://example.invalid', request: record}
      : {rawRequest: record, exportSession: () => undefined}
    return {client, requests}
  }

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'aclif-http-'))
    for (const k of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'OCLIF_TS_NODE']) saved[k] = process.env[k]
    process.env.XDG_CONFIG_HOME = join(home, 'config')
    process.env.XDG_CACHE_HOME = join(home, 'cache')
    process.env.OCLIF_TS_NODE = '0'
    config = await Config.load(process.cwd())
  })
  afterAll(async () => {
    for (const [name, create] of originalCreate) registry.plugin(name)!.createClient = create
    resetProcessPool()
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await rm(home, {recursive: true, force: true})
  })

  it.each(withHttp.map((e) => [e.plugin.name, e.plugin]))('%s: a GET manifest issues exactly one request with the resolved path and query', async (_name, p) => {
    const plugin = p as ProviderPlugin
    const fake = httpFake(plugin.name)
    originalCreate.set(plugin.name, plugin.createClient)
    plugin.createClient = async () => fake.client
    resetProcessPool()
    const envKeys = plugin.credentials.paths[0].requires.map((k) => plugin.credentials.fields[k]!.env)
    const before = envKeys.map((k) => process.env[k])
    for (const k of envKeys) process.env[k] = /URL$/.test(k) ? 'https://example.invalid' : 'placeholder'
    try {
      const manifest: CommandManifest = {
        id: `${plugin.name}:probe:get`,
        description: 'probe',
        aciMetadata: {mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 1, requiresConfirmation: false, prerequisites: []},
        request: {method: 'GET', path: '/things/{id}', query: {expand: '{expand}'}},
        flags: {id: {type: 'string', description: 'id', required: true}, expand: {type: 'string', description: 'expand'}},
      }
      const cls = manifestCommand(manifest, plugin)
      const out = await runClass(config, cls as never, ['--id', '42', '--expand', 'x', '--json'])
      expect(out.code, `${out.stdout}\n${out.stderr}`).toBe(0)
      expect(json<{success: boolean}>(out).success).toBe(true)
      expect(fake.requests).toHaveLength(1)
      const [first] = fake.requests
      if (plugin.name === 'salesforce') {
        expect(first[0]).toMatchObject({method: 'GET', url: '/things/42?expand=x'})
      } else {
        expect(first.slice(0, 3)).toEqual(['GET', '/things/42', {expand: 'x'}])
        expect(first[3]).toBeUndefined()
      }
    } finally {
      envKeys.forEach((k, i) => {
        if (before[i] === undefined) delete process.env[k]
        else process.env[k] = before[i]
      })
    }
  })

  it('every http adapter forwards method, path, query, and body unchanged', async () => {
    for (const {plugin} of withHttp) {
      const fake = httpFake(plugin.name)
      const adapter = plugin.http!(fake.client)
      await adapter.request({method: 'POST', path: '/a/b', query: {c: 'd'}, body: {e: 1}})
      expect(fake.requests, plugin.name).toHaveLength(1)
      const [args] = fake.requests
      if (plugin.name === 'salesforce') expect(args[0]).toMatchObject({method: 'POST', url: '/a/b?c=d', body: '{"e":1}'})
      else expect(args).toEqual(['POST', '/a/b', {c: 'd'}, {e: 1}])
    }
  })
})

describe('C-SEC-2 session snapshots', () => {
  const withSession = entries.filter(({plugin}) => plugin.session)
  const SESSION_FAKES: Record<string, {live: () => unknown; fresh: () => unknown}> = {
    salesforce: {live: () => ({accessToken: 'tok', instanceUrl: 'https://example.invalid'}), fresh: () => ({})},
    docusign: {live: () => ({exportSession: () => ({accessToken: 'tok', expiresAt: Math.floor(Date.now() / 1000) + 3600})}), fresh: () => ({exportSession: () => undefined})},
  }

  it.each(withSession.map((e) => [e.plugin.name, e.plugin]))('%s: save() carries state without credential secrets and with a usable expiry', (_name, p) => {
    const plugin = p as ProviderPlugin
    const fake = SESSION_FAKES[plugin.name]
    expect(fake, `add a session fake for ${plugin.name} to test/conformance/tenant.test.ts`).toBeDefined()
    const snapshot = plugin.session!.save(fake!.live())
    expect(snapshot, 'a live client yields a snapshot').toBeDefined()
    expect(snapshot!.state).toBeTypeOf('object')
    // Secret credential inputs (anything a non-session path needs) never
    // enter the snapshot; the session token itself is the state.
    const forbidden = new Set<string>()
    for (const path of plugin.credentials.paths) {
      if (path.authType === 'session') continue
      for (const k of [...path.requires, ...(path.optional ?? [])]) if (plugin.credentials.fields[k]?.secret) forbidden.add(k)
    }
    for (const k of Object.keys(snapshot!.state)) {
      expect(forbidden.has(k), `${plugin.name} snapshot stores credential secret ${k}`).toBe(false)
      expect(k).not.toMatch(/password|secret|privateKey/i)
    }
    if (snapshot!.expiresAt !== undefined) {
      expect(Date.parse(snapshot!.expiresAt)).toBeGreaterThan(Date.now())
    }
    expect(fieldKeys(plugin.credentials).length).toBeGreaterThan(0)
    expect(plugin.session!.save(fake!.fresh() as never), 'a client with no session yet yields undefined').toBeUndefined()
  })

  it('a restored client is rebuilt from the snapshot without a login', async () => {
    const sf = registry.plugin('salesforce')!
    const conn = await sf.session!.restore({instanceUrl: 'https://example.invalid', username: 'u', password: 'p', authType: 'credentials'}, {state: {accessToken: 'tok', instanceUrl: 'https://restored.example.invalid'}}) as {accessToken: string; instanceUrl: string}
    expect(conn.accessToken).toBe('tok')
    expect(conn.instanceUrl).toBe('https://restored.example.invalid')
    await expect(sf.session!.restore({instanceUrl: 'x', authType: 'session'}, {state: {}})).rejects.toThrow(/incomplete/)
    expect(vi.isMockFunction(sf.createClient)).toBe(false)
  })
})

export type _Catalog = TenantCatalog
