import {Config} from '@oclif/core'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {CORE_COMMANDS} from '../../src/cli/define-cli.js'
import {setCommandContext, resetCommandContext} from '../../src/core/command-context.js'
import {DEFAULT_POLICY} from '../../src/core/policy/policy.js'
import {builtinRegistry} from '../../src/providers/index.js'
import {assertEnvelope} from '../helpers/envelope.js'
import {json, runClass} from '../helpers/run-class.js'

/**
 * The core commands run in-process from src against a temp config home:
 * version, discover, learn, aliases, auth, manifests. The binary rows
 * (E-*) prove the same through the built CLI; this suite is what lets
 * coverage attribute their lines to src/.
 */
let config: Config
let home: string
let configDir: string
const saved: Record<string, string | undefined> = {}

builtinRegistry()
const run = (id: string, argv: string[]) => runClass(config, CORE_COMMANDS[id] as never, argv)

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'aclif-core-'))
  for (const k of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'OCLIF_TS_NODE', 'SF_INSTANCE_URL', 'SF_ACCESS_TOKEN']) saved[k] = process.env[k]
  process.env.XDG_CONFIG_HOME = join(home, 'config')
  process.env.XDG_CACHE_HOME = join(home, 'cache')
  process.env.OCLIF_TS_NODE = '0'
  delete process.env.SF_INSTANCE_URL
  delete process.env.SF_ACCESS_TOKEN
  config = await Config.load(process.cwd())
  configDir = config.configDir
  await mkdir(configDir, {recursive: true})
})
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await rm(home, {recursive: true, force: true})
})

describe('version, discover, learn', () => {
  it('version reports bin, versions, and contract', async () => {
    const out = await run('version', ['--json'])
    expect(out.code, out.stderr).toBe(0)
    expect(json(out)).toMatchObject({bin: config.bin, version: config.version, contract: expect.stringMatching(/^\d+\.\d+\.\d+$/)})
  })

  it('discover lists every provider with its tier and credential status', async () => {
    const out = await run('discover', ['--json'])
    const body = json<{providers: Array<{name: string; tier: string; status: string}>; total_commands: number}>(out)
    expect(body.providers.find((p) => p.name === 'salesforce')).toMatchObject({tier: 'native', status: 'not configured'})
    expect(body.total_commands).toBeGreaterThan(50)
    process.env.SF_INSTANCE_URL = 'https://x.example.com'
    process.env.SF_ACCESS_TOKEN = 't'
    const configured = json<{providers: Array<{name: string; status: string; auth: string}>}>(await run('discover', ['--json']))
    expect(configured.providers.find((p) => p.name === 'salesforce')).toMatchObject({status: 'configured', auth: 'Session token'})
    delete process.env.SF_INSTANCE_URL
    delete process.env.SF_ACCESS_TOKEN
  })

  it('learn briefs a provider and rejects an unknown one with exit 2', async () => {
    const out = await run('learn', ['servicenow', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const body = json<{provider: string; tier: string; auth_status: string; topics: Record<string, unknown>; canonical_entities: string[]}>(out)
    expect(body).toMatchObject({provider: 'servicenow', tier: 'native', auth_status: 'not configured'})
    expect(Object.keys(body.topics)).toContain('data')
    expect(body.canonical_entities).toContain('customer')
    const bad = await run('learn', ['nope', '--json'])
    expect(bad.code).toBe(2)
    expect(assertEnvelope(json(bad)).error).toMatchObject({code: 'UNKNOWN_PROVIDER', syntaxGuide: expect.stringContaining('salesforce')})
  })
})

describe('aliases', () => {
  const fixture = 'test/fixtures/aliases/two-instance.json'

  it('validate accepts the fixture and rejects garbage and unregistered providers', async () => {
    const ok = await run('aliases:validate', [fixture, '--json'])
    expect(ok.code, ok.stderr).toBe(0)
    expect(assertEnvelope<{valid: boolean; entities: string[]}>(json(ok)).result).toMatchObject({valid: true, id: 'two-instance-fixture'})
    const garbage = join(home, 'garbage.json')
    await writeFile(garbage, '{"id": 1}')
    const bad = await run('aliases:validate', [garbage, '--json'])
    expect(bad.code).toBe(2)
    expect(assertEnvelope(json(bad)).error?.code).toBe('INVALID_ALIAS_SET')
    const unknown = join(home, 'unknown.json')
    const set = JSON.parse(await readFile(fixture, 'utf8')) as {entities: Array<{mappings: Array<{provider: string}>}>}
    set.entities[0].mappings[0].provider = 'nosuch'
    await writeFile(unknown, JSON.stringify(set))
    const rejected = await run('aliases:validate', [unknown, '--json'])
    expect(rejected.code).toBe(2)
    expect(assertEnvelope(json(rejected)).error?.message).toContain('nosuch')
  })

  it('import copies the set under the config directory (dry-run first), then list and export show it', async () => {
    const dry = await run('aliases:import', [fixture, '--dry-run'])
    expect(dry.code, dry.stderr).toBe(0)
    expect(json(dry)).toMatchObject({dryRun: true, wouldExecute: {id: 'two-instance-fixture'}})
    const imported = await run('aliases:import', [fixture, '--name', 'orgs.json', '--json'])
    expect(imported.code, imported.stderr).toBe(0)
    expect(assertEnvelope<{file: string; entities: number}>(json(imported)).result!.file).toBe(join(configDir, 'aliases', 'orgs.json'))
    const list = assertEnvelope<{sets: Array<{id: string}>}>(json(await run('aliases:list', ['--json'])))
    expect(list.result!.sets.map((s) => s.id)).toContain('two-instance-fixture')
    const exported = assertEnvelope<{sets: Array<{id: string; entities: unknown[]}>}>(json(await run('aliases:export', ['--json'])))
    expect(exported.result!.sets.find((s) => s.id === 'two-instance-fixture')?.entities.length).toBeGreaterThan(0)
  })

  it('resolve maps a canonical name for a provider and instance, and explains a miss', async () => {
    const out = await run('aliases:resolve', ['customer', '--provider', 'servicenow', '--instance', 'primary', '--json'])
    expect(out.code, out.stderr).toBe(0)
    expect(assertEnvelope(json(out)).result).toMatchObject({canonical: 'customer', provider: 'servicenow', instance: 'primary', native: 'core_company'})
    const miss = await run('aliases:resolve', ['custmer', '--provider', 'servicenow', '--json'])
    expect(miss.code).toBe(2)
    expect(assertEnvelope(json(miss)).error).toMatchObject({code: 'CANONICAL_NOT_FOUND', syntaxGuide: expect.stringContaining('customer')})
    const badProvider = await run('aliases:resolve', ['customer', '--provider', 'nosuch', '--json'])
    expect(badProvider.code).toBe(2)
    expect(assertEnvelope(json(badProvider)).error?.code).toBe('UNKNOWN_PROVIDER')
  })
})

describe('auth', () => {
  it('status reports the identity provider, profile, and no sessions', async () => {
    setCommandContext(config, {identity: undefined, identityProvider: 'anonymous', policy: DEFAULT_POLICY, profile: 'dev'})
    const out = await run('auth:status', ['--json'])
    resetCommandContext(config)
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{identity: unknown; profile: string; sessions: unknown[]}>(json(out))
    expect(env.result).toMatchObject({profile: 'dev', sessions: []})
  })

  it('logout removes nothing when nothing is cached and rejects an unknown provider', async () => {
    const out = await run('auth:logout', ['salesforce', '--json'])
    expect(out.code, out.stderr).toBe(0)
    expect(assertEnvelope(json(out)).result).toEqual({provider: 'salesforce', removed: 0})
    const all = await run('auth:logout', ['--json'])
    expect(assertEnvelope(json(all)).result).toEqual({provider: null, removed: 0})
    const bad = await run('auth:logout', ['nosuch', '--json'])
    expect(bad.code).toBe(2)
    expect(assertEnvelope(json(bad)).error?.code).toBe('UNKNOWN_PROVIDER')
  })
})

describe('manifests', () => {
  const fixture = 'test/fixtures/manifests/salesforce-apex-quote-summary.json'

  it('validate accepts the fixture and rejects a manifest without aciMetadata', async () => {
    const ok = await run('manifests:validate', [fixture, '--json'])
    expect(ok.code, ok.stderr).toBe(0)
    expect(assertEnvelope(json(ok)).result).toMatchObject({valid: true, id: 'salesforce:apex:quote-summary'})
    const bad = join(home, 'bad-manifest.json')
    await writeFile(bad, JSON.stringify({id: 'salesforce:x:y', description: 'x', request: {method: 'GET', path: '/x'}, flags: {}}))
    const rejected = await run('manifests:validate', [bad, '--json'])
    expect(rejected.code).toBe(2)
    expect(assertEnvelope(json(rejected)).error).toMatchObject({code: 'INVALID_MANIFEST'})
  })

  it('list shows the manifests the selected profile declares', async () => {
    await writeFile(join(configDir, 'apex.json'), await readFile(fixture, 'utf8'))
    await writeFile(join(configDir, 'config.yaml'), 'default_profile: dev\nprofiles:\n  dev: {}\nmanifests:\n  dev:\n    salesforce: [./apex.json]\n')
    const out = await run('manifests:list', ['--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{profile: string | null; manifests: Array<{id: string; provider: string; method: string}>}>(json(out))
    expect(env.result!.manifests).toEqual([expect.objectContaining({id: 'salesforce:apex:quote-summary', provider: 'salesforce', method: 'GET'})])
    await rm(join(configDir, 'config.yaml'))
  })
})
