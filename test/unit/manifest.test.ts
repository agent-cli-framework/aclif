import {Ajv2020 as Ajv} from 'ajv/dist/2020.js'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {loadStandaloneManifestsSync} from '../../src/cli/config/manifest-store.js'
import {placeholdersIn, resolveRequest, validateManifest, type CommandManifest} from '../../src/core/manifest/manifest.js'
import {getRegistry} from '../../src/providers/index.js'
import {ConnectionPool} from '../../src/core/runtime/connection-pool.js'
import {StaticCredentialResolver} from '../../src/core/runtime/credential-resolver.js'
import {EventReporter} from '../../src/core/output/reporter.js'
import {Runtime} from '../../src/core/runtime/runtime.js'

const FIX = 'test/fixtures/manifests'
let apex: CommandManifest
let close: CommandManifest
beforeAll(async () => {
  apex = JSON.parse(await readFile(`${FIX}/salesforce-apex-quote-summary.json`, 'utf8'))
  close = JSON.parse(await readFile(`${FIX}/servicenow-scripted-close.json`, 'utf8'))
})

describe('C-MAN-1 manifest fixtures', () => {
  it('validate against the published schema and the validator, with every placeholder declared', async () => {
    const schema = JSON.parse(await readFile('schemas/manifest.schema.json', 'utf8'))
    const validate = new Ajv({strict: false}).compile(schema)
    for (const m of [apex, close]) {
      expect(validate(m), JSON.stringify(validate.errors)).toBe(true)
      expect(validateManifest(m)).toEqual([])
      for (const ph of placeholdersIn(m)) expect(m.flags).toHaveProperty(ph)
    }
    expect(placeholdersIn(close)).toEqual(['code', 'notes', 'sys-id', 'tags'])
  })

  it('rejects an undeclared placeholder, a bad id, and missing metadata', () => {
    expect(validateManifest({...apex, request: {...apex.request, path: '/x/{nope}'}})).toContain('placeholder {nope} is not a declared flag')
    expect(validateManifest({...apex, id: 'Salesforce Bad'})[0]).toMatch(/id must look like/)
    expect(validateManifest({...apex, aciMetadata: undefined})).toContain('aciMetadata is required')
  })
})

describe('U-MAN-1 request resolution and synthesised commands', () => {
  it('resolves path, optional query, and typed body from flags', () => {
    const r = resolveRequest(apex, {'quote-id': '0Q0/xx', currency: 'EUR'})
    expect(r).toEqual({method: 'GET', path: '/services/apexrest/quotes/0Q0%2Fxx/summary', query: {currency: 'EUR'}})
    expect(resolveRequest(apex, {'quote-id': '1'}).query).toBeUndefined()
    const b = resolveRequest(close, {'sys-id': 'abc', code: 'Solved', notes: 'done', tags: '["a","b"]'})
    expect(b.body).toEqual({resolution_code: 'Solved', notes: 'Closed by agent: done', tags: ['a', 'b']})
    expect(() => resolveRequest(close, {'sys-id': 'abc', code: 'Solved', notes: 'x', tags: '{bad'})).toThrow(/valid JSON/)
    expect(() => resolveRequest(apex, {})).toThrow(/--quote-id/)
  })

  it('runs through the runtime: --schema lists manifest flags, a read issues the request, a mutation honours --dry-run and --confirm', async () => {
    const runtime = await Runtime.start({cliRoot: process.cwd()})
    try {
      runtime.addManifestCommands('salesforce', [apex])
      runtime.addManifestCommands('servicenow', [close])
      expect(() => runtime.addManifestCommands('servicenow', [close])).toThrow(/collides/)
      expect(() => runtime.addManifestCommands('salesforce', [{...apex, id: 'salesforce:data:query'}])).toThrow(/collides/)

      const calls: unknown[] = []
      const pool = new ConnectionPool()
      pool.registerFactory('servicenow', {create: async () => ({rawRequest: async (...args: unknown[]) => (calls.push(args), {result: 'ok'})})})
      pool.registerFactory('salesforce', {create: async () => ({request: async (r: unknown) => (calls.push(r), {total: 1})})})
      const credentials = new StaticCredentialResolver(new Map([
        ['servicenow', {instanceUrl: 'https://sn.example.com', accessToken: 't', authType: 'session'}],
        ['salesforce', {instanceUrl: 'https://sf.example.com', accessToken: 't', authType: 'session'}],
      ]))
      const run = (argv: string[]) => runtime.run({argv, context: {requestId: 'r'}, credentials, pool, reporter: new EventReporter()})

      const schema = await run(['salesforce', 'apex', 'quote-summary', '--schema'])
      expect(schema.exitCode).toBe(0)
      const s = (schema.envelope as unknown as {result: {flags: Record<string, unknown>; aciMetadata: {mutability: string}}}).result
      expect(s.flags).toHaveProperty('quote-id')
      expect(s.flags).toHaveProperty('instance-url')
      expect(s.aciMetadata.mutability).toBe('read')

      const read = await run(['salesforce', 'apex', 'quote-summary', '--quote-id', '0Q0', '--currency', 'EUR'])
      expect(read.exitCode, JSON.stringify(read.envelope)).toBe(0)
      expect(calls.at(-1)).toMatchObject({method: 'GET', url: '/services/apexrest/quotes/0Q0/summary?currency=EUR'})
      expect(read.envelope).toMatchObject({success: true, result: {total: 1}, _context: {source: 'manifest'}})

      const dry = await run(['servicenow', 'scripted', 'close-incident', '--sys-id', 'abc', '--notes', 'n', '--dry-run'])
      expect(dry.exitCode).toBe(0)
      expect(calls.filter((c) => Array.isArray(c))).toHaveLength(0)

      const real = await run(['servicenow', 'scripted', 'close-incident', '--sys-id', 'abc', '--notes', 'n', '--confirm'])
      expect(real.exitCode, JSON.stringify(real.envelope)).toBe(0)
      expect(calls.at(-1)).toEqual(['POST', '/api/x_acme/incident/abc/close', undefined, {resolution_code: 'Solved', notes: 'Closed by agent: n', tags: undefined}])
    } finally {
      runtime.stop()
    }
  })
})

describe('U-MAN-2 standalone manifest store', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aclif-manifests-'))
    await writeFile(join(dir, 'apex.json'), JSON.stringify(apex))
    await writeFile(join(dir, 'close.json'), JSON.stringify(close))
    await writeFile(join(dir, 'broken.json'), JSON.stringify({...apex, id: 'salesforce:apex:broken', flags: {}}))
    await writeFile(join(dir, 'config.yaml'), [
      'default_profile: dev',
      'profiles:', '  dev: {}', '  other: {}',
      'manifests:',
      '  dev:',
      '    salesforce: [./apex.json, ./broken.json]',
      '    servicenow: [./close.json]',
      '    mautic: [./apex.json]',
      '  other:',
      '    servicenow: [./close.json]',
      '',
    ].join('\n'))
  })
  afterAll(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('loads manifests for the selected profile only, skips invalid or misfiled ones with warnings', () => {
    const warnings: string[] = []
    const dev = loadStandaloneManifestsSync(dir, undefined, (m) => warnings.push(m))
    expect(Object.keys(dev).sort()).toEqual(['salesforce', 'servicenow'])
    expect(dev.salesforce.map((m) => m.manifest.id)).toEqual(['salesforce:apex:quote-summary'])
    expect(dev.salesforce[0].file).toBe(join(dir, 'apex.json'))
    expect(warnings.some((w) => w.includes('broken.json') && w.includes('placeholder'))).toBe(true)
    expect(warnings.some((w) => w.includes("listed under provider 'mautic'"))).toBe(true)
    const other = loadStandaloneManifestsSync(dir, 'other', () => {})
    expect(Object.keys(other)).toEqual(['servicenow'])
    expect(loadStandaloneManifestsSync(dir, 'missing', () => {})).toEqual({})
    expect(getRegistry().ownerOf(apex.id)).toBeUndefined()
  })
})
