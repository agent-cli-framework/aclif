// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Conformance over provider source text, no execution: C-SEC-1, C-DEP-1,
 * C-TIER-1, and C-MAN-2 over the manifest fixtures.
 */
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {describe, expect, it} from 'vitest'

import {AciBaseCommand} from '../../cli/base-command.js'
import type {CommandManifest} from '../../core/manifest/manifest.js'
import type {ProviderTier} from '../../core/provider/registry.js'
import {tokenize} from '../tokenize.js'
import {eachRow, type ConformanceOptions} from './options.js'

const TIERS: ProviderTier[] = ['native', 'contributed', 'private']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

interface SourceFile {
  tier: ProviderTier
  provider: string
  path: string
  own: string
  text: string
  imports: string[]
  /** Imports that load code, as opposed to `import type`. */
  valueImports: string[]
}

function readAllowlist(path: string | undefined): Record<string, string> {
  if (!path || !existsSync(path)) return {}
  return (JSON.parse(readFileSync(path, 'utf8')) as {packages: Record<string, string>}).packages
}

export function sourceSuite(opts: ConformanceOptions): void {
  const rel = (p: string) => relative(opts.cliRoot, p).split(sep).join('/')
  const files: SourceFile[] = opts.sourceDirs.flatMap(({dir, tier}) => {
    const abs = resolve(opts.cliRoot, dir)
    if (!existsSync(abs)) return []
    return readdirSync(abs)
      .filter((n) => statSync(join(abs, n)).isDirectory() && existsSync(join(abs, n, 'plugin.ts')))
      .flatMap((provider) => walk(join(abs, provider)).map((path) => {
        const text = readFileSync(path, 'utf8')
        const statements = [...text.matchAll(/^\s*(?:import|export)\b[^\n]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)]
        const imports = statements.map((m) => m[1] ?? m[2])
        const valueImports = statements.filter((m) => !/^\s*(?:import|export)\s+type\b/.test(m[0])).map((m) => m[1] ?? m[2])
        return {tier, provider, path, own: join(abs, provider), text, imports, valueImports}
      }))
  })

  describe('C-DEP-1 dependency allowlist', () => {
    const allowlist = readAllowlist(resolve(opts.cliRoot, opts.dependencyAllowlist))
    const privateAllow = readAllowlist(opts.privateDependencyAllowlist ? resolve(opts.cliRoot, opts.privateDependencyAllowlist) : undefined)

    it('every package a provider imports is on the allowlist with a reason; private providers may extend it', () => {
      const problems: string[] = []
      for (const f of files) {
        const allowed = {...allowlist, ...(f.tier === 'private' ? privateAllow : {})}
        for (const spec of f.imports) {
          if (spec.startsWith('.') || spec.startsWith('node:')) continue
          const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
          if (pkg === 'aclif') continue
          if (!(pkg in allowed)) problems.push(`${rel(f.path)} imports ${pkg}`)
        }
      }
      expect(problems).toEqual([])
      for (const [pkg, reason] of Object.entries(allowlist)) expect(reason.length, `${pkg} reason`).toBeGreaterThan(10)
    })
  })

  describe('C-TIER-1 import boundaries', () => {
    if (opts.eslintConfig) {
      const eslintConfig = opts.eslintConfig
      it('the lint rule still fences core and cli from providers and every tier from every other', () => {
        const rule = (eslintConfig as Array<{rules?: Record<string, unknown>}>).map((c) => c.rules?.['import-x/no-restricted-paths']).find(Boolean) as [string, {zones: Array<{target: string; from: string}>}]
        expect(rule[0]).toBe('error')
        const zones = rule[1].zones.map((z) => `${z.target}<-${z.from}`)
        expect(zones).toContain('./src/core<-./src/providers')
        expect(zones).toContain('./src/cli<-./src/providers')
        for (const a of TIERS) for (const b of TIERS) if (a !== b) expect(zones).toContain(`./src/providers/${a}<-./src/providers/${b}`)
      })
    }

    it('provider source imports only its own directory by relative path' + (opts.frameworkSrc ? ', plus src/core, src/util, and the base command' : ''), () => {
      const problems: string[] = []
      const fw = opts.frameworkSrc ? resolve(opts.frameworkSrc) : undefined
      for (const f of files) {
        for (const spec of f.imports) {
          if (!spec.startsWith('.')) continue
          const target = resolve(dirname(f.path), spec)
          const inside = (dir: string) => !relative(dir, target).startsWith('..')
          if (inside(f.own)) continue
          if (fw && (inside(join(fw, 'core')) || inside(join(fw, 'util')) || target === join(fw, 'cli', 'base-command.js'))) continue
          problems.push(`${rel(f.path)} imports ${spec}`)
        }
      }
      expect(problems).toEqual([])
    })

    if (opts.frameworkSrc) {
      const fw = resolve(opts.frameworkSrc)
      it('core and cli reach providers only through src/providers/index.ts', () => {
        const problems: string[] = []
        for (const dir of ['core', 'cli']) {
          for (const p of walk(join(fw, dir))) {
            const text = readFileSync(p, 'utf8')
            for (const m of text.matchAll(/^\s*(?:import|export)\b[^\n]*?\bfrom\s+'([^']*providers\/[^']+)'/gm)) {
              if (!/providers\/index\.js$/.test(m[1])) problems.push(`${rel(p)} imports ${m[1]}`)
            }
          }
        }
        expect(problems).toEqual([])
      })
    }
  })

  describe('C-SEC-1 provider source touches no framework state', () => {
    it('never reads XDG directories, the environment, or the config, session, and tenant stores directly', () => {
      const problems: string[] = []
      for (const f of files) {
        for (const [i, line] of f.text.split('\n').entries()) {
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue
          if (/\b(configDir|cacheDir|dataDir)\b|homedir\(|process\.env\b/.test(line)) problems.push(`${rel(f.path)}:${i + 1}: ${line.trim()}`)
        }
        for (const spec of f.valueImports) if (/cli\/config\/|credentials\/session-cache|credentials\/secret-source|config\/tenant-cache/.test(spec)) problems.push(`${rel(f.path)} imports ${spec}`)
      }
      expect(problems).toEqual([])
    })

    it('writes to the filesystem only where a flag names the target', () => {
      const problems: string[] = []
      for (const f of files) {
        for (const [i, line] of f.text.split('\n').entries()) {
          if (!/\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|createWriteStream|rm|rmSync|unlink|unlinkSync|rename)\(/.test(line)) continue
          if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('import')) continue
          if (!/\bflags\b/.test(line)) problems.push(`${rel(f.path)}:${i + 1}: ${line.trim()}`)
        }
      }
      expect(problems).toEqual([])
    })
  })

  const fixtures = opts.manifestFixtures ? resolve(opts.cliRoot, opts.manifestFixtures) : undefined
  if (fixtures && existsSync(fixtures)) {
    describe('C-MAN-2 manifest examples parse against the manifest flags', () => {
      const manifests = readdirSync(fixtures).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(fixtures, n), 'utf8')) as CommandManifest)
      const baseFlags = {...AciBaseCommand.baseFlags} as Record<string, {type: string}>

      eachRow(manifests, '%s', (manifest) => {
        for (const ex of manifest.aciExamples ?? []) {
          const tokens = tokenize(ex.command)
          expect(tokens[0], ex.command).toBe('$BIN')
          const segments = manifest.id.split(':')
          expect(tokens.slice(1, 1 + segments.length), ex.command).toEqual(segments)
          const seen = new Set<string>()
          for (let i = 1 + segments.length; i < tokens.length; i++) {
            const t = tokens[i]
            expect(t.startsWith('--'), `${ex.command}: unexpected positional '${t}'`).toBe(true)
            const name = t.slice(2)
            const own = manifest.flags[name]
            const base = baseFlags[name]
            expect(own ?? base, `${ex.command}: unknown flag --${name}`).toBeDefined()
            seen.add(name)
            const isBoolean = own ? own.type === 'boolean' : base.type === 'boolean'
            if (!isBoolean) {
              i++
              expect(tokens[i], `${ex.command}: --${name} needs a value`).toBeDefined()
              expect(tokens[i].startsWith('--'), `${ex.command}: --${name} needs a value`).toBe(false)
            }
          }
          for (const [name, def] of Object.entries(manifest.flags)) if (def.required) expect(seen.has(name), `${ex.command}: missing required --${name}`).toBe(true)
        }
      })
    })
  }
}
