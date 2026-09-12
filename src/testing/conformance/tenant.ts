// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Conformance for the optional plugin surfaces, each driven through a fake
 * the caller supplies so no network is involved: C-TEN-1, C-TEN-2, C-TEN-3
 * for tenant walks; C-MAN-3 for http adapters; C-SEC-2 for session support.
 * A provider that adds one of these surfaces needs a fake in the options,
 * and the test says so.
 */
import {Config} from '@oclif/core'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {manifestCommand} from '../../core/manifest/manifest-command.js'
import type {CommandManifest} from '../../core/manifest/manifest.js'
import {fieldKeys} from '../../core/provider/credential-schema.js'
import type {ProviderPlugin} from '../../core/provider/plugin.js'
import {validateTenantCatalog} from '../../core/provider/tenant.js'
import {resetProcessPool} from '../../core/runtime/process-pool.js'
import {tenantCatalogErrors} from '../envelope.js'
import {json, runClass} from '../run.js'
import {eachRow, ownEntries, type ConformanceOptions} from './options.js'

export function tenantSuite(opts: ConformanceOptions): void {
  const entries = ownEntries(opts)
  const tenantFakes = opts.tenantFakes ?? {}
  const readOnly = opts.readOnlyMembers ?? {}
  const httpFakes = opts.httpFakes ?? (() => undefined)
  const sessionFakes = opts.sessionFakes ?? {}

  describe('C-TEN-1, C-TEN-2, C-TEN-3 tenant walks', () => {
    const withTenant = entries.filter(({plugin}) => plugin.tenant)

    it('every tenant provider has a recording fake in the conformance options and an introspect command with --bootstrap, --refresh, --all', () => {
      for (const {plugin} of withTenant) {
        expect(tenantFakes[plugin.name], `add a recording fake for ${plugin.name} to the conformance options (tenantFakes, readOnlyMembers)`).toBeDefined()
        expect(readOnly[plugin.name], `list the read-only members of ${plugin.name}'s client in readOnlyMembers`).toBeDefined()
        const introspect = plugin.commands[`${plugin.name}:introspect`] as unknown as {flags: Record<string, unknown>}
        expect(introspect, `${plugin.name}:introspect`).toBeDefined()
        for (const f of ['bootstrap', 'refresh', 'all']) expect(introspect.flags, `${plugin.name}:introspect --${f}`).toHaveProperty(f)
      }
    })

    eachRow(withTenant, '%s: buildCatalog reads only, and its output validates with provenance on every entity', async ({plugin}) => {
      const fake = tenantFakes[plugin.name]()
      const catalog = await plugin.tenant!.buildCatalog(fake.client, {})
      expect([...new Set(fake.calls)].filter((c) => !(readOnly[plugin.name] ?? []).includes(c)), 'members used beyond the read-only set').toEqual([])
      expect(validateTenantCatalog(catalog)).toEqual([])
      expect(tenantCatalogErrors(catalog)).toBe('')
      expect(catalog.provider).toBe(plugin.name)
      for (const e of catalog.entities) {
        expect(e.provenance, e.name).toBeDefined()
        for (const f of e.fields) expect(Object.keys(f).sort(), `${e.name}.${f.name} carries only structure, never values`).toEqual(Object.keys(f).filter((k) => ['name', 'label', 'type', 'custom', 'enum', 'references', 'required'].includes(k)).sort())
      }
    })
  })

  describe('C-MAN-3 http adapters', () => {
    const withHttp = entries.filter(({plugin}) => plugin.http)
    let config: Config
    let home: string
    const saved: Record<string, string | undefined> = {}
    const originalCreate = new Map<string, ProviderPlugin['createClient']>()

    beforeAll(async () => {
      home = await mkdtemp(join(tmpdir(), 'aclif-http-'))
      for (const k of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'OCLIF_TS_NODE']) saved[k] = process.env[k]
      process.env.XDG_CONFIG_HOME = join(home, 'config')
      process.env.XDG_CACHE_HOME = join(home, 'cache')
      process.env.OCLIF_TS_NODE = '0'
      config = await Config.load(opts.cliRoot)
    })
    afterAll(async () => {
      for (const [name, create] of originalCreate) opts.registry.plugin(name)!.createClient = create
      resetProcessPool()
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      await rm(home, {recursive: true, force: true})
    })

    it('every http provider has a recording fake in the conformance options', () => {
      for (const {plugin} of withHttp) expect(httpFakes(plugin.name), `add an http fake for ${plugin.name} to the conformance options (httpFakes)`).toBeDefined()
    })

    eachRow(withHttp, '%s: a GET manifest issues exactly one request with the resolved path and query', async ({plugin}) => {
      const fake = httpFakes(plugin.name)!
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
        expect(fake.requests, 'exactly one request').toHaveLength(1)
        // The adapter received the resolved path and query, in whatever
        // argument form its client takes.
        expect(JSON.stringify(fake.requests[0])).toContain('/things/42')
        expect(JSON.stringify(fake.requests[0])).toContain('expand')
      } finally {
        envKeys.forEach((k, i) => {
          if (before[i] === undefined) delete process.env[k]
          else process.env[k] = before[i]
        })
      }
    })

    it('every http adapter forwards method, path, query, and body', async () => {
      for (const {plugin} of withHttp) {
        const fake = httpFakes(plugin.name)
        if (!fake) continue
        const adapter = plugin.http!(fake.client)
        await adapter.request({method: 'POST', path: '/a/b', query: {c: 'd'}, body: {e: 1}})
        expect(fake.requests, plugin.name).toHaveLength(1)
        const text = JSON.stringify(fake.requests[0])
        for (const part of ['POST', '/a/b', 'c', 'd', 'e']) expect(text, `${plugin.name} forwards ${part}`).toContain(part)
      }
    })
  })

  describe('C-SEC-2 session snapshots', () => {
    const withSession = entries.filter(({plugin}) => plugin.session)

    eachRow(withSession, '%s: save() carries state without credential secrets and with a usable expiry', ({plugin}) => {
      const fake = sessionFakes[plugin.name]
      expect(fake, `add a session fake for ${plugin.name} to the conformance options (sessionFakes)`).toBeDefined()
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
  })
}
