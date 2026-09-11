import {Config} from '@oclif/core'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import type {AciMetadata, CommandExample} from '../../src/core/contract/aci.js'
import {tokenize} from '../../scripts/check-examples.js'
import {describePaths, fieldKeys} from '../../src/core/provider/credential-schema.js'
import type {ProviderPlugin} from '../../src/core/provider/plugin.js'
import {resetProcessPool} from '../../src/core/runtime/process-pool.js'
import {builtinRegistry} from '../../src/providers/index.js'
import {json, runClass} from '../helpers/run-class.js'

/**
 * Conformance that runs every provider command in-process:
 * C-META-2, every mutation honours --dry-run before touching its client;
 * C-CRED-2, every command without credentials exits 3 naming every path.
 */
type Cmd = {aciMetadata: AciMetadata; dryRunMode?: 'local' | 'server'; aciExamples?: CommandExample[]; flags?: Record<string, Record<string, unknown>>; args?: Record<string, Record<string, unknown>>}

/** Commands that need no client at all; they answer without credentials by design. */
const NO_CLIENT: Record<string, string> = {
  'google:discover': 'static catalogue of services and auth methods, no API call',
  'google:drive:view-url': 'formats a Drive URL locally, no API call',
}

const registry = builtinRegistry()
const entries = registry.entries()
const commands = entries.flatMap(({plugin}) => Object.entries(plugin.commands).map(([id, cls]) => ({id, cls: cls as unknown as Cmd, plugin})))

/** A client that fails on first use, so a command that reaches it before --dry-run is caught. */
const throwingClient = new Proxy({}, {
  get: (_t, p) => {
    if (p === 'then') return undefined
    throw new Error(`client used before --dry-run was honoured: ${String(p)}`)
  },
})

function dummy(name: string, def: Record<string, unknown>): string {
  if (Array.isArray(def.options) && def.options.length) return String(def.options[0])
  if (/values|json|body|payload|fields-json|record/i.test(name)) return '{"Name":"x"}'
  if (/query|soql/i.test(name)) return 'SELECT Id FROM Account LIMIT 1'
  if (/limit|offset|size|count|days|max|timeout|page|amount|budget|micros|hours|minutes|seconds|version/i.test(name)) return '1'
  if (/email/i.test(name)) return 'x@example.com'
  if (/url/i.test(name)) return 'https://example.com'
  if (/date|start|end|time/i.test(name)) return '2026-01-01'
  return 'x'
}

/**
 * Argv for a command: the flags and args of its first executable example
 * (C-EX-1 proves those parse), else placeholders for the required ones.
 * Introspection and base flags are dropped so the run reaches the command.
 */
function exampleArgv(id: string, cls: Cmd): string[] {
  const base = new Set(['json', 'pretty', 'confirm', 'dry-run', 'fields', 'truncate', 'full', 'profile', 'instance', 'identity-token'])
  for (const ex of cls.aciExamples ?? []) {
    if (/--schema|--examples|--shape|--discover|--changelog|--estimate|--flags-for/.test(ex.command)) continue
    const tokens = tokenize(ex.command)
    const rest = tokens.slice(1 + id.split(':').length)
    const out: string[] = []
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i]
      if (!t.startsWith('--')) {
        out.push(t)
        continue
      }
      const name = t.slice(2)
      const def = cls.flags?.[name]
      const takesValue = def ? def.type !== 'boolean' : i + 1 < rest.length && !rest[i + 1].startsWith('--')
      if (base.has(name)) {
        if (takesValue) i++
        continue
      }
      out.push(t)
      if (takesValue) out.push(rest[++i])
    }
    return out
  }
  return requiredArgv(cls)
}

/** Required flags and args of a command class, with placeholder values. */
function requiredArgv(cls: Cmd): string[] {
  const out: string[] = []
  for (const [name, def] of Object.entries(cls.args ?? {})) if (def.required) out.push(dummy(name, def))
  for (const [name, def] of Object.entries(cls.flags ?? {})) {
    if (!def.required) continue
    out.push(`--${name}`)
    if (def.type !== 'boolean') out.push(dummy(name, def))
  }
  return out
}

function credentialEnv(plugin: ProviderPlugin): Record<string, string> {
  const path = plugin.credentials.paths[0]
  const env: Record<string, string> = {}
  for (const k of path.requires) {
    const f = plugin.credentials.fields[k]!
    env[f.env] = /url/i.test(k) ? 'https://example.invalid' : /key/i.test(k) && /private/i.test(k) ? '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----' : 'placeholder'
  }
  for (const k of ['authType']) if (k in plugin.credentials.fields) delete env[k]
  return env
}

let config: Config
let home: string
const saved: Record<string, string | undefined> = {}
const originalCreate = new Map<string, ProviderPlugin['createClient']>()
const allCredentialEnv = new Set(entries.flatMap(({plugin}) => fieldKeys(plugin.credentials).map((k) => plugin.credentials.fields[k]!.env)))

function setEnv(vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v
}
function clearCredentialEnv(): void {
  for (const k of allCredentialEnv) delete process.env[k]
}

beforeAll(async () => {
  for (const k of [...allCredentialEnv, 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'OCLIF_TS_NODE']) saved[k] = process.env[k]
  home = await mkdtemp(join(tmpdir(), 'aclif-conformance-'))
  process.env.XDG_CONFIG_HOME = join(home, 'config')
  process.env.XDG_CACHE_HOME = join(home, 'cache')
  process.env.OCLIF_TS_NODE = '0'
  clearCredentialEnv()
  config = await Config.load(process.cwd())
  for (const {plugin} of entries) {
    originalCreate.set(plugin.name, plugin.createClient)
    plugin.createClient = async () => throwingClient
  }
  resetProcessPool()
})
afterAll(async () => {
  for (const {plugin} of entries) plugin.createClient = originalCreate.get(plugin.name)!
  resetProcessPool()
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await rm(home, {recursive: true, force: true})
})

describe('C-META-2 --dry-run precedes any client use', () => {
  const mutations = commands.filter(({cls}) => cls.aciMetadata.mutability !== 'read')
  it.each(mutations.map((m) => [m.id, m]))('%s', async (_id, m) => {
    const {id, cls, plugin} = m as {id: string; cls: Cmd; plugin: ProviderPlugin}
    if (cls.dryRunMode === 'server') {
      // The flag is forwarded to the API's validate-only mode, so the
      // client is used on purpose; P-MUT-1 for the provider covers it.
      expect(cls.dryRunMode).toBe('server')
      return
    }
    clearCredentialEnv()
    setEnv(credentialEnv(plugin))
    try {
      const out = await runClass(config, cls as never, [...exampleArgv(id, cls), '--dry-run', '--confirm', '--json'])
      expect(out.code, `${out.stdout}\n${out.stderr}`).toBe(0)
      expect(out.stdout, 'dry-run preview on stdout').toContain('"dryRun": true')
      expect(out.stderr).not.toContain('client used before')
    } finally {
      clearCredentialEnv()
    }
  })
})

describe('C-CRED-2 no credentials means exit 3 naming every path', () => {
  it.each(commands.map((c) => [c.id, c]))('%s', async (_id, c) => {
    const {id, cls, plugin} = c as {id: string; cls: Cmd; plugin: ProviderPlugin}
    clearCredentialEnv()
    const out = await runClass(config, cls as never, [...exampleArgv(id, cls), '--confirm', '--json'])
    if (NO_CLIENT[id]) {
      expect(out.code, `${id}: ${NO_CLIENT[id]}`).toBe(0)
      return
    }
    expect(out.code, `${out.stdout}\n${out.stderr}`).toBe(3)
    const body = json<{success: boolean; error: {code: string; syntaxGuide: string}}>(out)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('NO_CREDENTIALS')
    for (const p of describePaths(plugin.credentials)) expect(body.error.syntaxGuide).toContain(p)
  })
})
