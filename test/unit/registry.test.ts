import {describe, expect, it} from 'vitest'

import {defineProvider, type ProviderCommandClass, type ProviderPlugin} from '../../src/core/provider/plugin.js'
import {ProviderRegistry} from '../../src/core/provider/registry.js'
import {getRegistry} from '../../src/providers/index.js'
import type {AciMetadata} from '../../src/core/contract/aci.js'

const meta = (mutability: AciMetadata['mutability'] = 'read'): AciMetadata => ({
  mutability, idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 1, requiresConfirmation: false, prerequisites: [],
})
const cmd = (mutability: AciMetadata['mutability'] = 'read'): ProviderCommandClass =>
  class {
    static aciMetadata = meta(mutability)
  } as unknown as ProviderCommandClass

function plugin(name: string, over: Partial<ProviderPlugin> = {}): ProviderPlugin {
  return {
    name,
    displayName: name,
    description: name,
    metadata: {name, description: name, overview: '', querySyntax: '', providerSpecificFlags: [], topics: {}},
    credentials: {fields: {instanceUrl: {flag: 'instance-url', env: `${name.toUpperCase()}_URL`, description: ''}}, paths: [{authType: 'session', requires: ['instanceUrl'], description: 'url'}]},
    createClient: async () => ({}),
    commands: {[`${name}:things:list`]: cmd()},
    ...over,
  }
}

describe('U-REG-1 registry and defineProvider', () => {
  it('rejects duplicate names across tiers naming both tiers', () => {
    const r = new ProviderRegistry([{plugin: plugin('acme'), tier: 'native'}])
    expect(() => r.register({plugin: plugin('acme'), tier: 'private'})).toThrow(/registered twice.*native, private/)
  })

  it('rejects command id collisions and contributed providers without maintainers', () => {
    const r = new ProviderRegistry([{plugin: plugin('acme'), tier: 'native'}])
    expect(() => r.register({plugin: plugin('other', {commands: {'acme:things:list': cmd()}}), tier: 'native'})).toThrow(/declared by both/)
    expect(() => r.register({plugin: plugin('comm'), tier: 'contributed'})).toThrow(/must declare maintainers/)
    r.register({plugin: plugin('comm', {maintainers: ['x']}), tier: 'contributed'})
    expect(r.names()).toEqual(['acme', 'comm'])
    expect(r.ownerOf('comm:things:list')).toBe('comm')
    expect(Object.keys(r.commands())).toHaveLength(2)
  })

  it('defineProvider validates name, command prefixes, metadata, schema, and the health probe', () => {
    expect(() => defineProvider(plugin('Bad Name'))).toThrow(/name/)
    expect(() => defineProvider(plugin('acme', {commands: {'other:x': cmd()}}))).toThrow(/must start with 'acme:'/)
    expect(() => defineProvider(plugin('acme', {healthProbe: ['acme', 'missing']}))).toThrow(/healthProbe does not resolve/)
    expect(() => defineProvider(plugin('acme', {commands: {'acme:things:delete': cmd('delete')}, healthProbe: ['acme', 'things', 'delete']}))).toThrow(/not a read command/)
    expect(defineProvider(plugin('acme', {healthProbe: ['acme', 'things', 'list', '--limit', '1']})).name).toBe('acme')
  })

  it('the built-in registry holds every upstream provider with its tier; anything else is private', () => {
    const entries = getRegistry().entries()
    const upstream = Object.fromEntries(entries.filter((e) => e.tier !== 'private').map((e) => [e.plugin.name, e.tier]))
    expect(upstream).toEqual({
      salesforce: 'native', servicenow: 'native', docusign: 'native', agentforce: 'native',
      google: 'contributed',
    })
    const upstreamCommands = entries
      .filter((e) => e.tier !== 'private')
      .reduce((n, e) => n + Object.keys(e.plugin.commands).length, 0)
    expect(upstreamCommands).toBe(59)
  })
})
