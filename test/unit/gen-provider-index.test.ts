import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

/** U-GEN-1: the provider index generator against a temporary tree. */
const SCRIPT = resolve('scripts/gen-provider-index.mjs')
let root: string

function provider(tier: string, name: string, withPlugin = true): void {
  const dir = join(root, 'src', 'providers', tier, name)
  mkdirSync(dir, {recursive: true})
  if (withPlugin) writeFileSync(join(dir, 'plugin.ts'), `export const ${name}Plugin = defineProvider({name: '${name}'})\n`)
}

function run(env: Record<string, string> = {}): {stdout: string; stderr: string; status: number} {
  const r = spawnSync(process.execPath, [SCRIPT], {cwd: root, env: {...process.env, ACI_PROVIDER_TIERS: '', ACI_EXCLUDE_PROVIDERS: '', ...env}, encoding: 'utf8'})
  return {stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 1}
}
const index = () => readFileSync(join(root, 'src', 'providers', 'index.generated.ts'), 'utf8')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aclif-gen-'))
  provider('native', 'alpha')
  provider('native', 'beta')
  provider('contributed', 'gamma')
  provider('private', 'delta')
  mkdirSync(join(root, 'src', 'providers', 'private', 'README-only'), {recursive: true})
})
afterAll(() => rmSync(root, {recursive: true, force: true}))

describe('U-GEN-1 provider index generator', () => {
  it('lists providers from every tier in tier order, and reports a directory without plugin.ts', () => {
    const r = run()
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('4 providers')
    expect(r.stderr).toContain('README-only has no plugin.ts')
    const out = index()
    expect(out).toContain("import {alphaPlugin} from './native/alpha/plugin.js'")
    expect(out).toContain("{plugin: gammaPlugin, tier: 'contributed'}")
    expect(out).toContain("{plugin: deltaPlugin, tier: 'private'}")
    expect(out.indexOf('alphaPlugin, tier')).toBeLessThan(out.indexOf('gammaPlugin, tier'))
    expect(out.indexOf('gammaPlugin, tier')).toBeLessThan(out.indexOf('deltaPlugin, tier'))
  })

  it('ACI_PROVIDER_TIERS restricts tiers and ACI_EXCLUDE_PROVIDERS drops by name', () => {
    expect(run({ACI_PROVIDER_TIERS: 'native,private', ACI_EXCLUDE_PROVIDERS: 'beta'}).status).toBe(0)
    const out = index()
    expect(out).toContain('alphaPlugin')
    expect(out).not.toContain('betaPlugin')
    expect(out).not.toContain('gammaPlugin')
    expect(out).toContain('deltaPlugin')
    const bad = run({ACI_PROVIDER_TIERS: 'native,bogus'})
    expect(bad.status).not.toBe(0)
    expect(bad.stderr).toContain("unknown tier 'bogus'")
  })

  it('skips a tier directory with no providers and rejects the same name in two tiers', () => {
    rmSync(join(root, 'src', 'providers', 'contributed'), {recursive: true})
    expect(run().status).toBe(0)
    expect(index()).not.toContain('contributed')
    provider('private', 'alpha')
    const dup = run()
    expect(dup.status).not.toBe(0)
    expect(dup.stderr).toContain("Provider 'alpha' exists in two tiers")
    rmSync(join(root, 'src', 'providers', 'private', 'alpha'), {recursive: true})
    const noSymbol = join(root, 'src', 'providers', 'native', 'nosym')
    mkdirSync(noSymbol)
    writeFileSync(join(noSymbol, 'plugin.ts'), 'export default {}\n')
    expect(run().stderr).toContain("expected 'export const <x> = defineProvider('")
    rmSync(noSymbol, {recursive: true})
  })

  it('emits the oclif topic table from provider metadata topics', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {oclif: {topics: Record<string, {description: string}>}}
    for (const t of ['discover', 'learn', 'auth', 'aliases', 'manifests', 'salesforce', 'salesforce:data', 'servicenow', 'servicenow:data']) expect(pkg.oclif.topics, t).toHaveProperty(t)
    expect(Object.keys(pkg.oclif.topics)).toEqual([...Object.keys(pkg.oclif.topics)].sort())
  })
})
