import {Ajv2020 as Ajv} from 'ajv/dist/2020.js'
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {FileTenantCache} from '../../src/cli/config/tenant-cache.js'
import {closestEntity, instanceKey, validateTenantCatalog, type TenantCatalog} from '../../src/core/provider/tenant.js'
import {catalogFromDiscovery as sfCatalog} from '../../src/providers/native/salesforce/tenant.js'
import {catalogFromDiscovery as snCatalog} from '../../src/providers/native/servicenow/tenant.js'
import type {DiscoveredField, DiscoveredObject} from '../../src/core/contract/aci.js'

const field = (name: string, over: Partial<DiscoveredField> = {}): DiscoveredField => ({
  name, label: name, type: 'string', length: 0, nillable: true, createable: true, updateable: true, defaultValue: null,
  picklistValues: [], referenceTo: [], relationshipName: null, externalId: false, unique: false, calculated: false, ...over,
})
const object = (apiName: string, custom: boolean, fields: DiscoveredField[]): DiscoveredObject => ({
  apiName, label: apiName, labelPlural: apiName, custom, keyPrefix: '', queryable: true, createable: true, updateable: true, deletable: true, fields, childRelationships: [],
})

const catalog: TenantCatalog = {
  provider: 'salesforce',
  capturedAt: '2026-09-10T00:00:00.000Z',
  entities: [
    {name: 'Warranty__c', label: 'Warranty', custom: true, provenance: 'metadata', fields: [{name: 'Status__c', label: 'Status', type: 'picklist', enum: ['Open', 'Closed'], custom: true}]},
    {name: 'Account', label: 'Account', custom: false, provenance: 'metadata', fields: [{name: 'Tier__c', label: 'Tier', type: 'string', custom: true}]},
  ],
  permissions: null,
}

describe('U-TEN-1 tenant cache and key', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aclif-tenant-'))
  })
  afterEach(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('round-trips a catalogue and isolates instance keys', async () => {
    const cache = new FileTenantCache(dir)
    await cache.save('salesforce', 'key-a', catalog)
    expect(await cache.load('salesforce', 'key-a')).toEqual(catalog)
    expect(await cache.load('salesforce', 'key-b')).toBeUndefined()
    expect(await cache.load('servicenow', 'key-a')).toBeUndefined()
    if (process.platform !== 'win32') expect((await stat(cache.path('salesforce', 'key-a'))).mode & 0o777).toBe(0o600)
  })

  it('treats a corrupt file as missing with a warning', async () => {
    const warnings: string[] = []
    const cache = new FileTenantCache(dir, (m) => warnings.push(m))
    await cache.save('salesforce', 'k', catalog)
    await writeFile(cache.path('salesforce', 'k'), '{not json')
    expect(await cache.load('salesforce', 'k')).toBeUndefined()
    await writeFile(cache.path('salesforce', 'k'), JSON.stringify({provider: 'salesforce'}))
    expect(await cache.load('salesforce', 'k')).toBeUndefined()
    expect(warnings).toHaveLength(2)
  })

  it('instanceKey separates providers, instances, identities, and auth types', () => {
    const base = {instanceUrl: 'https://a', username: 'u', authType: 'credentials' as const}
    const k = instanceKey('salesforce', base)
    expect(instanceKey('salesforce', base)).toBe(k)
    expect(instanceKey('servicenow', base)).not.toBe(k)
    expect(instanceKey('salesforce', {...base, instanceUrl: 'https://b'})).not.toBe(k)
    expect(instanceKey('salesforce', {...base, username: 'v'})).not.toBe(k)
    expect(instanceKey('salesforce', {...base, authType: 'session'})).not.toBe(k)
  })

  it('closestEntity finds case-insensitive, contained, and near-miss names', () => {
    expect(closestEntity(catalog, 'account')).toBe('Account')
    expect(closestEntity(catalog, 'Warranty')).toBe('Warranty__c')
    expect(closestEntity(catalog, 'Acount')).toBe('Account')
    expect(closestEntity(catalog, 'Opportunity')).toBeUndefined()
  })
})

describe('C-TEN-2 catalogue shape', () => {
  it('the published JSON schema and the validator agree on a good catalogue', async () => {
    const schema = JSON.parse(await readFile('schemas/tenant-catalog.schema.json', 'utf8'))
    const ajv = new Ajv({strict: false})
    const validate = ajv.compile(schema)
    expect(validate(catalog), JSON.stringify(validate.errors)).toBe(true)
    expect(validateTenantCatalog(catalog)).toEqual([])
  })

  it('both reject a catalogue that stores field values or lacks provenance', async () => {
    const schema = JSON.parse(await readFile('schemas/tenant-catalog.schema.json', 'utf8'))
    const validate = new Ajv({strict: false}).compile(schema)
    const bad = JSON.parse(JSON.stringify(catalog)) as TenantCatalog
    ;(bad.entities[0].fields[0] as unknown as Record<string, unknown>).sampleValue = 'leak'
    delete (bad.entities[1] as unknown as Record<string, unknown>).provenance
    expect(validate(bad)).toBe(false)
    const errors = validateTenantCatalog(bad)
    expect(errors.some((e) => e.includes('unexpected key'))).toBe(true)
    expect(errors.some((e) => e.includes('provenance'))).toBe(true)
  })

  it('Salesforce mapping keeps custom objects, custom fields on standard objects, enums, and references', () => {
    const cat = sfCatalog({
      customObjects: [object('Warranty__c', true, [field('Status__c', {type: 'picklist', picklistValues: [{value: 'Open', label: 'Open', active: true, defaultValue: false}, {value: 'Old', label: 'Old', active: false, defaultValue: false}]}), field('Account__c', {type: 'reference', referenceTo: ['Account']})])],
      standardObjectCustomFields: new Map([['Account', [field('Tier__c')]], ['Contact', []]]),
      discoveredAt: '2026-09-10T00:00:00.000Z',
      orgId: 'org',
      apiVersion: '59.0',
    })
    expect(validateTenantCatalog(cat)).toEqual([])
    expect(cat.entities.map((e) => [e.name, e.custom])).toEqual([['Account', false], ['Warranty__c', true]])
    const w = cat.entities.find((e) => e.name === 'Warranty__c')!
    expect(w.fields.find((f) => f.name === 'Status__c')?.enum).toEqual(['Open'])
    expect(w.fields.find((f) => f.name === 'Account__c')?.references).toEqual(['Account'])
    expect(cat.apiVersion).toBe('59.0')
  })

  it('ServiceNow mapping marks u_ and x_ tables custom', () => {
    const cat = snCatalog({tables: [object('incident', false, [field('u_region')]), object('u_asset_audit', false, [])], discoveredAt: '2026-09-10T00:00:00.000Z', instanceUrl: 'https://sn'})
    expect(validateTenantCatalog(cat)).toEqual([])
    expect(cat.entities.map((e) => [e.name, e.custom])).toEqual([['incident', false], ['u_asset_audit', true]])
    expect(cat.entities[0].fields[0].custom).toBe(true)
  })
})
