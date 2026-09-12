import {describe, expect, it, vi} from 'vitest'

import {builtinRegistry} from '../../src/providers/index.js'
import {httpFake, salesforceFake, servicenowFake} from './fakes.js'

/**
 * Provider-specific assertions for the built-in tenant walks, http
 * adapters, and session restore. The generic rules live in the conformance
 * suite; these pin the exact behaviour of the framework's own providers.
 */
const registry = builtinRegistry()

describe('built-in tenant walks', () => {
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

describe('built-in http adapters', () => {
  it('forward method, path, query, and body in each client\'s own argument form', async () => {
    for (const {plugin} of registry.entries().filter((e) => e.plugin.http)) {
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

describe('built-in session restore', () => {
  it('a restored Salesforce client is rebuilt from the snapshot without a login', async () => {
    const sf = registry.plugin('salesforce')!
    const conn = await sf.session!.restore({instanceUrl: 'https://example.invalid', username: 'u', password: 'p', authType: 'credentials'}, {state: {accessToken: 'tok', instanceUrl: 'https://restored.example.invalid'}}) as {accessToken: string; instanceUrl: string}
    expect(conn.accessToken).toBe('tok')
    expect(conn.instanceUrl).toBe('https://restored.example.invalid')
    await expect(sf.session!.restore({instanceUrl: 'x', authType: 'session'}, {state: {}})).rejects.toThrow(/incomplete/)
    expect(vi.isMockFunction(sf.createClient)).toBe(false)
  })
})
