import {Config, Flags} from '@oclif/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {AciBaseCommand} from '../../src/cli/base-command.js'
import type {AciMetadata, FlagCategorization, ResponseShape} from '../../src/core/contract/aci.js'
import {json, runClass} from '../helpers/run-class.js'
import {assertAciMetadata} from '../helpers/envelope.js'

/**
 * U-INTRO-1 to U-INTRO-4: the introspection flags short-circuit inside
 * init() on a synthetic command with a required flag, with no
 * credentials in the environment, and never reach run().
 */
const meta: AciMetadata = {
  mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 1, requiresConfirmation: false, prerequisites: [],
}

class Synthetic extends AciBaseCommand {
  static override id = 'acme:things:list'
  static override description = 'List things'
  static override flags = {
    ...AciBaseCommand.baseFlags,
    ...AciBaseCommand.flagsFor({
      fields: {
        instanceUrl: {flag: 'instance-url', env: 'ACME_URL', description: 'Instance URL'},
        accessToken: {flag: 'api-key', env: 'ACME_KEY', description: 'API key', secret: true},
      },
      paths: [{authType: 'session', requires: ['instanceUrl', 'accessToken'], description: 'url and key'}],
    }),
    query: Flags.string({description: 'Filter', required: true, char: 'q'}),
    limit: Flags.integer({description: 'Max', default: 25}),
    format: Flags.string({description: 'Format', options: ['wide', 'narrow']}),
  }
  static override args = {
    name: {description: 'Thing name', required: false} as never,
  }
  static override aciMetadata = meta
  static override responseShape: ResponseShape | null = {description: 'things', fields: {id: {type: 'string', description: ''}, name: {type: 'string', description: ''}}, example: {}}
  static ran = 0
  async run(): Promise<void> {
    Synthetic.ran++
    throw new Error('run() must not be reached by an introspection flag')
  }
}

class Categorised extends Synthetic {
  static override id = 'acme:things:find'
  static override flagCategories: FlagCategorization = {query: ['filtering'], limit: ['pagination', 'filtering']}
}

let config: Config
const saved = {ACME_URL: process.env.ACME_URL, ACME_KEY: process.env.ACME_KEY}
beforeAll(async () => {
  delete process.env.ACME_URL
  delete process.env.ACME_KEY
  process.env.OCLIF_TS_NODE = '0'
  config = await Config.load(process.cwd())
})
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v
})

describe('U-INTRO-1 introspection short-circuit', () => {
  const flags = [['--schema'], ['--examples'], ['--shape'], ['--changelog'], ['--discover'], ['--flags-for', 'auth'], ['--estimate']]
  it.each(flags)('%s exits 0 with JSON and never calls run()', async (...argv) => {
    const out = await runClass(config, Synthetic, [...argv, '--json'])
    expect(out.code, out.stderr).toBe(0)
    expect(json(out)).toBeTypeOf('object')
    expect(Synthetic.ran).toBe(0)
  })

  it('is the raw argv that matters: --schema after a required flag that is absent still works', async () => {
    const out = await runClass(config, Synthetic, ['--limit', '3', '--schema'])
    expect(out.code).toBe(0)
    expect(json(out).command).toBe('acme:things:list')
  })
})

describe('U-INTRO-2 --schema content', () => {
  it('lists flag type, required, default, options, char, args, base flags, and valid aciMetadata', async () => {
    const out = await runClass(config, Synthetic, ['--schema'])
    const schema = json<{command: string; description: string; flags: Record<string, Record<string, unknown>>; args: Record<string, Record<string, unknown>>; aciMetadata: AciMetadata}>(out)
    expect(schema.command).toBe('acme:things:list')
    expect(schema.description).toBe('List things')
    expect(schema.flags.query).toMatchObject({type: 'option', required: true, char: 'q', description: 'Filter'})
    expect(schema.flags.limit).toMatchObject({type: 'option', required: false, default: 25})
    expect(schema.flags.format).toMatchObject({options: ['wide', 'narrow']})
    expect(schema.flags['dry-run']).toMatchObject({type: 'boolean', default: false})
    for (const base of ['json', 'fields', 'truncate', 'full', 'pretty', 'profile', 'confirm', 'instance']) expect(schema.flags, base).toHaveProperty(base)
    expect(schema.flags['instance-url']).toMatchObject({description: 'Instance URL'})
    expect(schema.flags['api-key']).toMatchObject({description: 'API key'})
    expect(schema.args.name).toMatchObject({description: 'Thing name', required: false})
    expect(schema.aciMetadata).toEqual(meta)
    assertAciMetadata(schema.aciMetadata, 'synthetic')
  })

  it('--shape returns the declared responseShape, --estimate derives token counts from it, --changelog and --examples fall back', async () => {
    const shape = json<{responseShape: ResponseShape}>(await runClass(config, Synthetic, ['--shape']))
    expect(Object.keys(shape.responseShape.fields)).toEqual(['id', 'name'])
    const est = json<{estimate: {fieldsPerRecord: number; tokensPerRecord: number}; aciMetadata: Partial<AciMetadata>}>(await runClass(config, Synthetic, ['--estimate']))
    expect(est.estimate).toMatchObject({fieldsPerRecord: 2, tokensPerRecord: 30})
    expect(est.aciMetadata).toEqual({apiCallsConsumed: 1, mutability: 'read'})
    const log = json<{changelog: Array<{version: string}>}>(await runClass(config, Synthetic, ['--changelog']))
    expect(log.changelog[0].version).toBeTruthy()
    const ex = json<{examples: Array<{command: string}>}>(await runClass(config, Synthetic, ['--examples']))
    expect(ex.examples[0].command).toBe(`${config.bin} acme things list --help`)
  })
})

describe('U-INTRO-3 --discover', () => {
  const synthetic = (cfg: Config): Config => {
    const cmds = [
      {id: 'acme:things:list', description: 'List', hidden: false, aciMetadata: meta},
      {id: 'acme:things:get', description: 'Get', hidden: false},
      {id: 'acme:things:secret', description: 'Hidden', hidden: true},
      {id: 'acme:widgets:list', description: 'Widgets', hidden: false},
      {id: 'discover', description: 'Discover', hidden: false},
      {id: 'version', description: 'Version', hidden: false},
    ]
    const topics = [
      {name: 'acme', description: 'Acme'},
      {name: 'acme:things', description: 'Things'},
      {name: 'acme:things:nested', description: 'Nested'},
      {name: 'acme:widgets', description: 'Widgets'},
      {name: 'other', description: 'Other'},
    ]
    return new Proxy(cfg, {
      get: (t, p) => (p === 'commands' ? cmds : p === 'topics' ? topics : Reflect.get(t, p)),
    }) as Config
  }

  it('computes siblings (sorted, hidden excluded, with aciMetadata) and direct child topics', async () => {
    const out = json<{topic: string; siblingCommands: Array<{command: string; aciMetadata: unknown}>; childTopics: Array<{topic: string}>; suggestedStart: string}>(
      await runClass(synthetic(config), Synthetic, ['--discover']),
    )
    expect(out.topic).toBe('acme:things')
    expect(out.siblingCommands.map((c) => c.command)).toEqual(['acme:things:get', 'acme:things:list'])
    expect(out.siblingCommands[1].aciMetadata).toEqual(meta)
    expect(out.siblingCommands[0].aciMetadata).toBeNull()
    expect(out.childTopics.map((t) => t.topic)).toEqual(['acme:things:nested'])
    expect(out.suggestedStart).toBe(`${config.bin} acme things get --schema --json`)
  })

  it('root topic case lists top-level commands and top-level topics', async () => {
    class Root extends Synthetic {
      static override id = 'version'
    }
    const out = json<{topic: string; siblingCommands: Array<{command: string}>; childTopics: Array<{topic: string}>}>(await runClass(synthetic(config), Root, ['--discover']))
    expect(out.topic).toBe('(root)')
    expect(out.siblingCommands.map((c) => c.command)).toEqual(['discover', 'version'])
    expect(out.childTopics.map((t) => t.topic)).toEqual(['acme', 'other'])
  })
})

describe('U-INTRO-4 --flags-for', () => {
  it('honors explicit flagCategories', async () => {
    const filtering = json<{category: string; flags: Record<string, unknown>}>(await runClass(config, Categorised, ['--flags-for', 'filtering']))
    expect(filtering.category).toBe('filtering')
    expect(Object.keys(filtering.flags).sort()).toEqual(['limit', 'query'])
    const pagination = json<{flags: Record<string, unknown>}>(await runClass(config, Categorised, ['--flags-for', 'pagination']))
    expect(Object.keys(pagination.flags)).toEqual(['limit'])
    const auth = json<{flags: Record<string, unknown>}>(await runClass(config, Categorised, ['--flags-for', 'auth']))
    expect(Object.keys(auth.flags)).toEqual([])
  })

  it('falls back to inference and finds schema-generated auth flags', async () => {
    const auth = json<{flags: Record<string, unknown>}>(await runClass(config, Synthetic, ['--flags-for', 'auth']))
    for (const f of ['instance-url', 'api-key', 'profile', 'identity-token']) expect(auth.flags, f).toHaveProperty(f)
    expect(auth.flags.query).toBeUndefined()
    const out = json<{flags: Record<string, unknown>}>(await runClass(config, Synthetic, ['--flags-for', 'output']))
    for (const f of ['json', 'fields', 'truncate']) expect(out.flags, f).toHaveProperty(f)
    const filtering = json<{flags: Record<string, unknown>}>(await runClass(config, Synthetic, ['--flags-for', 'filtering']))
    expect(Object.keys(filtering.flags).sort()).toEqual(['limit', 'query'])
  })
})
