import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {AciBaseCommand} from '../../src/cli/base-command.js'
import {CORE_COMMANDS} from '../../src/cli/define-cli.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../src/core/contract/aci.js'
import {fieldKeys} from '../../src/core/provider/credential-schema.js'
import type {ProviderPlugin} from '../../src/core/provider/plugin.js'
import type {ProviderTier} from '../../src/core/provider/registry.js'
import {builtinRegistry} from '../../src/providers/index.js'
import {assertAciMetadata} from '../helpers/envelope.js'

/**
 * Conformance over the registry, static: what every provider and command
 * declares. C-META-1 (with K-3), C-META-3, C-META-4, C-ID-1, C-PROBE-1,
 * C-DISC-1, C-DOC-1, C-DOC-2, C-DOC-3, C-CRED-1, C-CRED-3, C-EX-3, C-TIER-2.
 */
type Cmd = typeof AciBaseCommand & {aciMetadata: AciMetadata; responseShape?: ResponseShape | null; aciExamples?: CommandExample[]; flags?: Record<string, Record<string, unknown>>}

const registry = builtinRegistry()
const entries = registry.entries()
const commands = entries.flatMap(({plugin, tier}) => Object.entries(plugin.commands).map(([id, cls]) => ({id, cls: cls as unknown as Cmd, plugin, tier})))
const label = (id: string) => id

describe('C-META-1 and K-3 aciMetadata', () => {
  it.each(commands.map((c) => [c.id, c]))('%s declares complete, valid aciMetadata', (_id, c) => {
    assertAciMetadata((c as {cls: Cmd}).cls.aciMetadata, label((c as {id: string}).id))
  })

  it('core commands declare it too', () => {
    for (const [id, cls] of Object.entries(CORE_COMMANDS)) assertAciMetadata((cls as unknown as Cmd).aciMetadata, id)
  })
})

describe('C-META-3 confirmation', () => {
  it('delete, all_records, and code_exec commands require confirmation', () => {
    const missing = commands
      .filter(({cls}) => cls.aciMetadata.mutability === 'delete' || cls.aciMetadata.blastRadius === 'all_records' || cls.aciMetadata.capabilities?.includes('code_exec'))
      .filter(({cls}) => !cls.aciMetadata.requiresConfirmation)
      .map(({id}) => id)
    expect(missing).toEqual([])
  })

  it('a command that requires confirmation shows --confirm in every example that would execute', () => {
    const bad: string[] = []
    for (const {id, cls} of commands) {
      if (!cls.aciMetadata.requiresConfirmation) continue
      for (const ex of cls.aciExamples ?? []) {
        if (/--dry-run|--schema|--examples|--shape/.test(ex.command)) continue
        if (!ex.command.includes('--confirm')) bad.push(`${id}: ${ex.command}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('C-META-4 response shapes', () => {
  it('every read command declares responseShape', () => {
    const missing = commands.filter(({cls}) => cls.aciMetadata.mutability === 'read' && !cls.responseShape).map(({id}) => id)
    expect(missing).toEqual([])
  })
})

describe('C-ID-1, C-PROBE-1, C-DISC-1', () => {
  it('every command id starts with its provider name', () => {
    for (const {id, plugin} of commands) expect(id.startsWith(`${plugin.name}:`), id).toBe(true)
  })

  it('healthProbe resolves to a registered read command', () => {
    for (const {plugin} of entries) {
      if (!plugin.healthProbe) continue
      const probeId = plugin.healthProbe.filter((a) => !a.startsWith('-')).join(':')
      const target = Object.keys(plugin.commands).filter((id) => probeId === id || probeId.startsWith(`${id}:`)).sort((a, b) => b.length - a.length)[0]
      expect(target, `${plugin.name} healthProbe`).toBeDefined()
      expect(plugin.commands[target].aciMetadata.mutability, `${plugin.name} healthProbe ${target}`).toBe('read')
    }
  })

  it('a provider with schema commands has entities, describe, and sample', () => {
    for (const {plugin} of entries) {
      const ids = Object.keys(plugin.commands)
      if (!ids.some((id) => id.startsWith(`${plugin.name}:schema:`))) continue
      for (const c of ['entities', 'describe', 'sample']) expect(ids, `${plugin.name}:schema:${c}`).toContain(`${plugin.name}:schema:${c}`)
    }
  })
})

describe('C-DOC-1, C-DOC-2, C-DOC-3 documentation', () => {
  it('metadata.topics lists exactly the registered commands under each topic', () => {
    const problems: string[] = []
    for (const {plugin} of entries) {
      const declared = new Set<string>()
      for (const [topic, meta] of Object.entries(plugin.metadata.topics)) {
        for (const c of meta.commands) {
          const id = `${plugin.name}:${topic}:${c}`
          if (!(id in plugin.commands)) problems.push(`${plugin.name}: topics.${topic} lists '${c}' but ${id} is not registered`)
          declared.add(id)
        }
      }
      for (const id of Object.keys(plugin.commands)) {
        if (id.split(':').length < 3) continue
        if (!declared.has(id)) problems.push(`${id} is registered but absent from metadata.topics`)
      }
    }
    expect(problems).toEqual([])
  })

  it('every provider has docs/providers/<tier>/<name>/SETUP.md that names the binary as $BIN', () => {
    for (const {plugin, tier} of entries) {
      const file = join('docs', 'providers', tier, plugin.name, 'SETUP.md')
      expect(existsSync(file), file).toBe(true)
      const text = readFileSync(file, 'utf8')
      expect(text, `${file} starts with a heading`).toMatch(/^# /)
      expect(text, `${file} shows how to verify`).toContain('$BIN')
    }
  })

  it('contributed providers declare maintainers matching their CODEOWNERS line', () => {
    const owners = readFileSync('.github/CODEOWNERS', 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    for (const {plugin, tier} of entries) {
      if (tier !== 'contributed') continue
      expect(plugin.maintainers?.length, `${plugin.name} maintainers`).toBeGreaterThan(0)
      const line = owners.find((l) => l.startsWith(`src/providers/contributed/${plugin.name}/`))
      expect(line, `CODEOWNERS line for src/providers/contributed/${plugin.name}/`).toBeDefined()
      const handles = line!.split(/\s+/).slice(1).map((h) => h.replace(/^@/, '').split('/')[0]).sort()
      expect(handles).toEqual([...plugin.maintainers!].map((m) => m.replace(/^@/, '')).sort())
    }
    for (const line of owners) expect(line, 'CODEOWNERS never lists a private path').not.toContain('/private/')
  })
})

describe('C-CRED-1 and C-CRED-3 credential schemas', () => {
  const SECRET_NAME = /password|secret|privateKey|refreshToken|accessToken|securityToken|developerToken|serviceAccountKey/i

  it('paths are non-empty, reference declared fields, and secret-looking fields are marked secret', () => {
    for (const {plugin} of entries) {
      const keys = new Set(fieldKeys(plugin.credentials))
      expect(plugin.credentials.paths.length, `${plugin.name} paths`).toBeGreaterThan(0)
      for (const p of plugin.credentials.paths) {
        expect(p.requires.length, `${plugin.name} ${p.authType} requires`).toBeGreaterThan(0)
        for (const k of [...p.requires, ...(p.optional ?? [])]) expect(keys.has(k), `${plugin.name} ${p.authType} references ${k}`).toBe(true)
      }
      for (const k of keys) {
        if (SECRET_NAME.test(k)) expect(plugin.credentials.fields[k]?.secret, `${plugin.name}.${k} must be secret`).toBe(true)
      }
    }
  })

  it('generated auth flags are present on every command and never shadowed by a command flag', () => {
    for (const {id, cls, plugin} of commands) {
      for (const k of fieldKeys(plugin.credentials)) {
        const f = plugin.credentials.fields[k]!
        if (!f.flag) continue
        const def = cls.flags?.[f.flag]
        expect(def, `${id} --${f.flag}`).toBeDefined()
        expect(def!.description, `${id} --${f.flag} description`).toBe(f.description)
        expect(def!.env, `${id} --${f.flag} env`).toBe(f.env)
      }
    }
  })
})

describe('C-EX-3 examples name nothing internal', () => {
  const INTERNAL = /promptone|napawines|medtech|electromotion|p1seed|p1cli|yourcorp|localhost|127\.0\.0\.1/i
  const EMAIL = /[\w.+-]+@([\w-]+\.)+[a-z]{2,}/gi
  const URL = /https?:\/\/([^\s/'"]+)/gi
  const ABS_PATH = /(^|[\s"'=])(\/(home|Users|app|tmp|var|etc)\/|[A-Z]:\\)/
  const okEmail = (e: string) => /@(example\.(com|org|net)|[\w.-]*google\.com)$/i.test(e)
  const okHost = (h: string) => /(^|\.)(example\.(com|org|net)|salesforce\.com|force\.com|service-now\.com|docusign\.(com|net)|googleapis\.com|google\.com|linkedin\.com|mautic\.(com|org))$/i.test(h)

  const texts = (): Array<{where: string; text: string; tier: ProviderTier}> => {
    const out: Array<{where: string; text: string; tier: ProviderTier}> = []
    for (const {id, cls, tier} of commands) for (const ex of cls.aciExamples ?? []) out.push({where: id, text: ex.command, tier})
    for (const {plugin, tier} of entries) for (const [topic, meta] of Object.entries(plugin.metadata.topics)) for (const p of meta.commonPatterns) out.push({where: `${plugin.name}:${topic} commonPatterns`, text: p, tier})
    return out
  }

  it('native and contributed examples use example.com identities, public hosts, and relative paths', () => {
    const problems: string[] = []
    for (const {where, text, tier} of texts()) {
      if (tier === 'private') continue
      if (INTERNAL.test(text)) problems.push(`${where}: internal name in '${text}'`)
      for (const m of text.match(EMAIL) ?? []) if (!okEmail(m)) problems.push(`${where}: email ${m}`)
      for (const m of text.matchAll(URL)) if (!okHost(m[1])) problems.push(`${where}: host ${m[1]}`)
      if (ABS_PATH.test(text)) problems.push(`${where}: absolute path in '${text}'`)
    }
    expect(problems).toEqual([])
  })
})

describe('C-TIER-2 layout', () => {
  it('each tier directory holds only provider directories, plus the private README and allowlist', () => {
    const byTier = new Map<ProviderTier, string[]>()
    for (const {plugin, tier} of entries) byTier.set(tier, [...(byTier.get(tier) ?? []), plugin.name])
    for (const tier of ['native', 'contributed', 'private'] as ProviderTier[]) {
      const dir = join('src', 'providers', tier)
      if (!existsSync(dir)) continue
      const names: string[] = []
      for (const name of readdirSync(dir)) {
        if (tier === 'private' && ['README.md', 'dependency-allowlist.json'].includes(name)) continue
        expect(statSync(join(dir, name)).isDirectory(), `${dir}/${name} is not a provider directory`).toBe(true)
        expect(existsSync(join(dir, name, 'plugin.ts')), `${dir}/${name}/plugin.ts`).toBe(true)
        names.push(name)
      }
      expect(names.sort()).toEqual((byTier.get(tier) ?? []).sort())
    }
    const top = readdirSync(join('src', 'providers')).filter((n) => !['native', 'contributed', 'private'].includes(n)).sort()
    expect(top).toEqual(['dependency-allowlist.json', 'index.generated.ts', 'index.ts'])
  })

  it('registered plugins are defineProvider() results with matching metadata names', () => {
    for (const {plugin} of entries) {
      expect((plugin as ProviderPlugin).metadata.name).toBe(plugin.name)
      expect(Object.values(plugin.commands).every((c) => (c as unknown as {provider?: ProviderPlugin}).provider === plugin), `${plugin.name} commands carry the plugin`).toBe(true)
    }
  })
})
