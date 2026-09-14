import {Config} from '@oclif/core'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'

import initHook from '../../src/cli/hooks/init.js'
import prerunHook from '../../src/cli/hooks/prerun.js'
import finallyHook from '../../src/cli/hooks/finally.js'
import {ensureCommandContext, profileNameFromArgv} from '../../src/cli/context.js'
import {applyScopedEnv, envScope, scopedEnvName} from '../../src/cli/env.js'
import {standaloneConfigDir} from '../../src/cli/config/paths.js'
import {clearOperation, installSigintHandler, registerOperation} from '../../src/cli/sigint-handler.js'
import {setCommandOutcome} from '../../src/cli/outcome.js'
import {defineCli, currentCli} from '../../src/cli/define-cli.js'
import {getCommandContext, resetCommandContext} from '../../src/core/command-context.js'
import {defineProvider, type ProviderCommandClass} from '../../src/core/provider/plugin.js'
import {setActiveRegistry} from '../../src/core/provider/registry.js'
import {builtinRegistry} from '../../src/providers/index.js'
import {signHs256} from '../../src/core/identity/index.js'

/**
 * The oclif hooks, the CLI context, scoped environment, config paths,
 * SIGINT handling, and defineCli() driven directly with a fake hook
 * context. The binary rows prove the same end to end.
 */
let config: Config
let home: string
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}
const hookThis = () => {
  const warnings: string[] = []
  return {
    config,
    warn: (m: string) => warnings.push(m),
    error: (m: string, opts?: {exit?: number}) => {
      throw Object.assign(new Error(m), {oclif: {exit: opts?.exit ?? 2}})
    },
    warnings,
  }
}
const writeConfig = async (text: string) => {
  await mkdir(config.configDir, {recursive: true})
  await writeFile(join(config.configDir, 'config.yaml'), text)
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'aclif-hooks-'))
  setEnv('XDG_CONFIG_HOME', join(home, 'config'))
  setEnv('XDG_CACHE_HOME', join(home, 'cache'))
  setEnv('OCLIF_TS_NODE', '0')
  for (const k of ['ACLIF_PROFILE', 'ACLIF_IDENTITY_TOKEN', 'ACLIF_IDENTITY_SECRET', 'MYCLI_PROFILE', 'MYCLI_CONFIG_DIR', 'SF_INSTANCE_URL', 'SF_ACCESS_TOKEN']) setEnv(k, undefined)
  config = await Config.load(process.cwd())
})
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await rm(home, {recursive: true, force: true})
})
afterEach(() => {
  resetCommandContext(config)
  clearOperation()
})

describe('context and env', () => {
  it('profileNameFromArgv reads --profile, --profile=, then the scoped env', () => {
    expect(profileNameFromArgv(['x', '--profile', 'dev'])).toBe('dev')
    expect(profileNameFromArgv(['--profile=qa'])).toBe('qa')
    expect(profileNameFromArgv([], {ACLIF_PROFILE: 'env'})).toBe('env')
    expect(profileNameFromArgv([], {})).toBeUndefined()
  })

  it('ensureCommandContext loads the profile into the environment once, resolves identity and policy, and is memoised per config', async () => {
    await writeConfig('default_profile: dev\nprofiles:\n  dev:\n    salesforce:\n      instance_url: https://profile.example.com\n      access_token: from-profile\n')
    const ctx = await ensureCommandContext(config, ['salesforce', 'data', 'query'])
    expect(ctx).toMatchObject({identityProvider: 'anonymous', identity: undefined, profile: 'dev'})
    expect(ctx.configFile).toBe(join(config.configDir, 'config.yaml'))
    expect(process.env.SF_INSTANCE_URL).toBe('https://profile.example.com')
    expect(process.env.SF_ACCESS_TOKEN).toBe('from-profile')
    expect(await ensureCommandContext(config, ['other'])).toBe(ctx)
    expect(getCommandContext(config)).toBe(ctx)
    setEnv('SF_INSTANCE_URL', undefined)
    setEnv('SF_ACCESS_TOKEN', undefined)
  })

  it('a missing profile is a ConfigError, and a static JWT identity is verified', async () => {
    await writeConfig('profiles:\n  dev: {}\n')
    await expect(ensureCommandContext(config, ['--profile', 'missing'])).rejects.toThrow(/Profile 'missing' not found/)
    resetCommandContext(config)
    await writeConfig("identity:\n  provider: static-jwt\npolicy:\n  require_identity: true\n")
    setEnv('ACLIF_IDENTITY_SECRET', 'shh')
    const token = signHs256({sub: 'u1', name: 'User One'}, 'shh')
    const ctx = await ensureCommandContext(config, ['--identity-token', token])
    expect(ctx.identity).toMatchObject({id: 'u1'})
    expect(ctx.policy.require_identity).toBe(true)
    setEnv('ACLIF_IDENTITY_SECRET', undefined)
  })

  it('scoped environment names map onto the framework names without overriding them', () => {
    expect(envScope('mycli')).toBe('MYCLI')
    expect(envScope('my-cli')).toBe('MY_CLI')
    expect(scopedEnvName('mycli', 'PROFILE')).toBe('MYCLI_PROFILE')
    const env: NodeJS.ProcessEnv = {MYCLI_PROFILE: 'scoped', MYCLI_INSTANCE: 'eu', ACLIF_INSTANCE: 'already'}
    applyScopedEnv('mycli', env)
    expect(env.ACLIF_PROFILE).toBe('scoped')
    expect(env.ACLIF_INSTANCE).toBe('already')
    const untouched: NodeJS.ProcessEnv = {ACLIF_PROFILE: 'x'}
    applyScopedEnv('aclif', untouched)
    expect(untouched).toEqual({ACLIF_PROFILE: 'x'})
  })

  it('standaloneConfigDir honors the scoped override, XDG, and the home fallback', () => {
    expect(standaloneConfigDir('mycli', 'mycli', {MYCLI_CONFIG_DIR: '/etc/mycli'})).toBe('/etc/mycli')
    expect(standaloneConfigDir('mycli', 'mycli', {XDG_CONFIG_HOME: '/xdg'})).toBe(join('/xdg', 'mycli'))
    expect(standaloneConfigDir('mycli', 'mycli', {HOME: '/home/u'})).toBe(join('/home/u', '.config', 'mycli'))
  })
})

describe('hooks', () => {
  it('init installs SIGINT handling, applies the scoped env, and builds the context; policy exempt ids skip the context', async () => {
    await writeConfig('profiles:\n  dev: {}\n')
    // The scoped name maps onto ACLIF_PROFILE only for a CLI whose bin is
    // not aclif (see the env test); this Config is the framework's own.
    setEnv('ACLIF_PROFILE', 'dev')
    const self = hookThis()
    await initHook.call(self as never, {id: 'salesforce:data:query', argv: [], config, context: self as never})
    expect(getCommandContext(config)?.profile).toBe('dev')
    setEnv('ACLIF_PROFILE', undefined)
    resetCommandContext(config)
    await initHook.call(hookThis() as never, {id: 'version', argv: [], config, context: hookThis() as never})
    expect(getCommandContext(config)).toBeUndefined()
  })

  it('init and prerun turn a config error into exit 2 and a policy denial into exit 3', async () => {
    await writeConfig('profiles:\n  dev: {}\n')
    setEnv('ACLIF_PROFILE', 'missing')
    await expect(initHook.call(hookThis() as never, {id: 'salesforce:data:query', argv: [], config, context: hookThis() as never})).rejects.toMatchObject({oclif: {exit: 2}})
    setEnv('ACLIF_PROFILE', undefined)
    resetCommandContext(config)
    await writeConfig('policy:\n  require_identity: true\n')
    const denied = prerunHook.call(hookThis() as never, {Command: {id: 'salesforce:data:query', aciMetadata: {mutability: 'read'}} as never, argv: [], config, context: hookThis() as never})
    await expect(denied).rejects.toMatchObject({oclif: {exit: 3}})
    resetCommandContext(config)
    await writeConfig('')
    const confirm = prerunHook.call(hookThis() as never, {Command: {id: 'salesforce:apex:run', aciMetadata: {mutability: 'update', requiresConfirmation: true, blastRadius: 'filtered_set'}} as never, argv: ['--code', 'x'], config, context: hookThis() as never})
    await expect(confirm).rejects.toMatchObject({oclif: {exit: 2}})
    resetCommandContext(config)
    const self = hookThis()
    await prerunHook.call(self as never, {Command: {id: 'salesforce:data:dml', aciMetadata: {mutability: 'delete', requiresConfirmation: false, blastRadius: 'filtered_set'}} as never, argv: ['--confirm'], config, context: self as never})
    expect(self.warnings.join(' ')).toContain('--dry-run')
  })

  it('finally writes the audit line with the exit code and error from a thrown error or a reported outcome', async () => {
    const lines: string[] = []
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      lines.push(String(chunk))
      return true
    }) as typeof process.stderr.write)
    try {
      await finallyHook.call(hookThis() as never, {id: 'salesforce:data:query', argv: [], config, context: hookThis() as never, error: Object.assign(new Error('bad'), {code: 'X'})} as never)
      setCommandOutcome({exitCode: 1, error: {code: 'COMMAND_ERROR', message: 'reported'}})
      await finallyHook.call(hookThis() as never, {id: 'salesforce:data:query', argv: [], config, context: hookThis() as never} as never)
      await finallyHook.call(hookThis() as never, {id: 'discover', argv: [], config, context: hookThis() as never} as never)
      await finallyHook.call(hookThis() as never, {id: 'salesforce:data:query', argv: [], config, context: hookThis() as never, error: Object.assign(new Error('EEXIT: 2'), {oclif: {exit: 2}})} as never)
      await finallyHook.call(hookThis() as never, {id: 'version', argv: [], config, context: hookThis() as never} as never)
    } finally {
      write.mockRestore()
    }
    const audits = lines.filter((l) => l.startsWith('[AUDIT] ')).map((l) => JSON.parse(l.slice(8)) as Record<string, unknown>)
    expect(audits).toHaveLength(4)
    expect(audits[0]).toMatchObject({command: 'salesforce:data:query', exitCode: 1, user: null, error: {code: 'X', message: 'bad'}})
    expect(audits[1]).toMatchObject({exitCode: 1, error: {code: 'COMMAND_ERROR', message: 'reported'}})
    expect(audits[2]).toMatchObject({command: 'discover', exitCode: 0})
    expect(audits[3]).toMatchObject({exitCode: 2})
    expect(audits[3].error).toBeUndefined()
  })

  it('SIGINT during a registered mutation warns on stderr and exits 130; a read exits silently', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const lines: string[] = []
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      lines.push(String(chunk))
      return true
    }) as typeof process.stderr.write)
    try {
      installSigintHandler()
      registerOperation('salesforce:data:dml', 'create')
      process.emit('SIGINT')
      expect(exit).toHaveBeenCalledWith(130)
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({warning: 'SIGINT received during mutation operation', command: 'salesforce:data:dml', mutability: 'create'})
      lines.length = 0
      clearOperation()
      registerOperation('salesforce:data:query', 'read')
      process.emit('SIGINT')
      expect(lines).toEqual([])
    } finally {
      write.mockRestore()
      exit.mockRestore()
      process.removeAllListeners('SIGINT')
    }
  })
})

describe('defineCli', () => {
  const meta = {mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 1, requiresConfirmation: false, prerequisites: []} as const
  const plugin = defineProvider({
    name: 'acme',
    displayName: 'Acme',
    description: 'Acme',
    metadata: {name: 'acme', description: 'Acme', overview: '', querySyntax: '', providerSpecificFlags: [], topics: {}},
    credentials: {fields: {instanceUrl: {flag: 'instance-url', env: 'ACME_URL', description: ''}}, paths: [{authType: 'session', requires: ['instanceUrl'], description: 'url'}]},
    createClient: async () => ({}),
    commands: {'acme:things:list': class {
      static aciMetadata = meta
    } as unknown as ProviderCommandClass},
  })

  afterAll(() => {
    setActiveRegistry(builtinRegistry())
  })

  it('assembles core commands plus provider commands under the chosen bin, applying the scoped env', () => {
    setEnv('MYCLI_PROFILE', 'from-scope')
    setEnv('ACLIF_PROFILE', undefined)
    const cli = defineCli({bin: 'mycli', providers: [plugin], manifests: false})
    expect(cli.bin).toBe('mycli')
    expect(cli.dirname).toBe('mycli')
    expect(Object.keys(cli.COMMANDS)).toContain('discover')
    expect(Object.keys(cli.COMMANDS)).toContain('acme:things:list')
    expect(cli.registry.get('acme')?.tier).toBe('private')
    expect(currentCli()).toBe(cli)
    expect(process.env.ACLIF_PROFILE).toBe('from-scope')
    setEnv('MYCLI_PROFILE', undefined)
    setEnv('ACLIF_PROFILE', undefined)
    const bare = defineCli({bin: 'bare', dirname: 'bare-cli', providers: [{plugin, tier: 'native'}], coreCommands: false, manifests: false, commands: {extra: class {} as never}})
    expect(Object.keys(bare.COMMANDS).sort()).toEqual(['acme:things:list', 'extra'])
    expect(bare.dirname).toBe('bare-cli')
    expect(bare.registry.get('acme')?.tier).toBe('native')
  })

  it('loads standalone manifests from the CLI config directory and rejects a bad bin name', async () => {
    const dir = join(home, 'manifests-cli')
    await mkdir(dir, {recursive: true})
    await writeFile(join(dir, 'ping.json'), JSON.stringify({id: 'acme:things:ping', description: 'ping', aciMetadata: meta, request: {method: 'GET', path: '/ping'}, flags: {}}))
    await writeFile(join(dir, 'config.yaml'), 'default_profile: default\nprofiles:\n  default: {}\nmanifests:\n  default:\n    acme: [./ping.json]\n    nosuch: [./ping.json]\n')
    setEnv('MANI_CONFIG_DIR', dir)
    const warnings: string[] = []
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      warnings.push(String(chunk))
      return true
    }) as typeof process.stderr.write)
    try {
      const cli = defineCli({bin: 'mani', providers: [plugin]})
      expect(Object.keys(cli.COMMANDS)).toContain('acme:things:ping')
    } finally {
      write.mockRestore()
      setEnv('MANI_CONFIG_DIR', undefined)
    }
    expect(warnings.join('')).toContain("listed under provider 'nosuch'")
    expect(() => defineCli({bin: 'Bad Name', providers: []})).toThrow(/bin 'Bad Name'/)
  })
})
