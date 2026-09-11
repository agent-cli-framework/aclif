import {Config} from '@oclif/core'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {resetProcessPool} from '../../src/core/runtime/process-pool.js'
import {builtinRegistry} from '../../src/providers/index.js'
import type {ProviderPlugin} from '../../src/core/provider/plugin.js'
import {runClass, type RunOutput} from './run-class.js'
import {runInProcess} from '../../scripts/capture-golden.js'

/**
 * Shared scaffolding for the provider fixture suites: a temp XDG home, the
 * loaded oclif Config, the provider plugin from the src registry, and a
 * runner that executes one of its commands in-process. Credentials are
 * applied to the environment per test and removed afterwards.
 */
export interface ProviderHarness {
  config: Config
  plugin: ProviderPlugin
  home: string
  /** Run a provider command class from src (no hooks). */
  run(id: string, argv: string[]): Promise<RunOutput>
  /** Run through the oclif catalogue (lib) so the prerun policy hook applies. */
  runWithHooks(id: string, argv: string[]): Promise<RunOutput>
  setEnv(vars: Record<string, string | undefined>): void
  /** Forget cached clients and sessions so the next command authenticates again. */
  fresh(): Promise<void>
  close(): Promise<void>
}

export async function providerHarness(provider: string): Promise<ProviderHarness> {
  const home = await mkdtemp(join(tmpdir(), `aclif-p-${provider}-`))
  const saved: Record<string, string | undefined> = {}
  const set = (k: string, v: string | undefined) => {
    if (!(k in saved)) saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  set('XDG_CONFIG_HOME', join(home, 'config'))
  set('XDG_CACHE_HOME', join(home, 'cache'))
  set('OCLIF_TS_NODE', '0')
  set('HOME', home)
  const registry = builtinRegistry()
  const plugin = registry.plugin(provider)
  if (!plugin) throw new Error(`no provider ${provider}`)
  for (const f of Object.values(plugin.credentials.fields)) set(f.env, undefined)
  const config = await Config.load(process.cwd())
  resetProcessPool()
  return {
    config,
    plugin,
    home,
    run: (id, argv) => {
      const cls = plugin.commands[id]
      if (!cls) throw new Error(`no command ${id}`)
      return runClass(config, cls as never, argv)
    },
    runWithHooks: (id, argv) => runInProcess(config, id, argv),
    setEnv: (vars) => {
      for (const [k, v] of Object.entries(vars)) set(k, v)
    },
    fresh: async () => {
      resetProcessPool()
      await rm(join(home, 'cache'), {recursive: true, force: true})
    },
    close: async () => {
      resetProcessPool()
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      await rm(home, {recursive: true, force: true})
    },
  }
}

export const parse = <T = Record<string, unknown>>(out: RunOutput): T => {
  try {
    return JSON.parse(out.stdout) as T
  } catch {
    throw new Error(`stdout is not JSON (exit ${out.code}):\n${out.stdout}\n${out.stderr}`)
  }
}
