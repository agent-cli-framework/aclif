import {Config} from '@oclif/core'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {FileTenantCache} from '../../src/cli/config/tenant-cache.js'
import {instanceKey, type TenantCatalog} from '../../src/core/provider/tenant.js'
import {runInProcess} from '../../scripts/capture-golden.js'

/**
 * U-TEN-2: with a catalog cached for the instance the environment points
 * at, `learn` appends the instance block and `--schema` lists
 * availableEntities. No network: the catalog is seeded directly.
 */
const creds = {instanceUrl: 'https://example.my.salesforce.com', accessToken: 'tok', authType: 'session' as const}
const catalog: TenantCatalog = {
  provider: 'salesforce',
  capturedAt: '2026-09-10T00:00:00.000Z',
  entities: [{name: 'Warranty__c', label: 'Warranty', custom: true, provenance: 'metadata', fields: []}],
  permissions: null,
}

let home: string
let config: Config
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string) => {
  saved[k] = process.env[k]
  process.env[k] = v
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'aclif-tenant-consumers-'))
  setEnv('XDG_CACHE_HOME', join(home, 'cache'))
  setEnv('XDG_CONFIG_HOME', join(home, 'config'))
  setEnv('SF_INSTANCE_URL', creds.instanceUrl)
  setEnv('SF_ACCESS_TOKEN', creds.accessToken)
  process.env.OCLIF_TS_NODE = '0'
  config = await Config.load(process.cwd())
  await new FileTenantCache(config.cacheDir).save('salesforce', instanceKey('salesforce', creds), catalog)
})
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await rm(home, {recursive: true, force: true})
})

describe('U-TEN-2 catalog consumers', () => {
  it('learn appends the instance block from the cached catalog', async () => {
    const out = await runInProcess(config, 'learn', ['salesforce', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const body = JSON.parse(out.stdout) as {auth_status: string; instance: {entities: string[]; custom_entities: string[]}}
    expect(body.auth_status).toMatch(/^configured via/)
    expect(body.instance.entities).toEqual(['Warranty__c'])
    expect(body.instance.custom_entities).toEqual(['Warranty__c'])
  })

  it('--schema on a provider command lists availableEntities; --schema on a core command does not', async () => {
    const out = await runInProcess(config, 'salesforce:data:query', ['--schema'])
    expect(out.code, out.stderr).toBe(0)
    const body = JSON.parse(out.stdout) as {availableEntities?: string[]}
    expect(body.availableEntities).toEqual(['Warranty__c'])
    const core = await runInProcess(config, 'discover', ['--schema'])
    expect(JSON.parse(core.stdout)).not.toHaveProperty('availableEntities')
  })

  it('learn for a provider with a tenant walk but no catalog points at --bootstrap', async () => {
    const out = await runInProcess(config, 'learn', ['servicenow', '--json'])
    const body = JSON.parse(out.stdout) as {instance: {captured_at: null; bootstrap: string}}
    expect(body.instance.captured_at).toBeNull()
    expect(body.instance.bootstrap).toContain('servicenow introspect --bootstrap')
  })
})
