// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Config} from '@oclif/core'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ProviderPlugin} from '../core/provider/plugin.js'
import type {ProviderRegistry} from '../core/provider/registry.js'
import {resetProcessPool} from '../core/runtime/process-pool.js'
import {runClass, runInProcess, type RunOutput} from './run.js'

/**
 * Shared scaffolding for provider fixture suites: a temp XDG home, the
 * loaded oclif Config of the CLI under test, the provider plugin from its
 * registry, and a runner that executes one of its commands in-process.
 * Credentials are applied to the environment per test and removed
 * afterwards.
 */
export interface ProviderHarness {
  config: Config
  plugin: ProviderPlugin
  home: string
  /** Run a provider command class directly (no hooks). */
  run(id: string, argv: string[]): Promise<RunOutput>
  /** Run through the oclif catalog so the prerun policy hook applies. */
  runWithHooks(id: string, argv: string[]): Promise<RunOutput>
  setEnv(vars: Record<string, string | undefined>): void
  /** Forget cached clients and sessions so the next command authenticates again. */
  fresh(): Promise<void>
  close(): Promise<void>
}

export interface HarnessOptions {
  /** The registry holding the provider, usually the CLI's `registry` export. */
  registry: ProviderRegistry
  /** Package root of the CLI under test, where oclif reads package.json and lib/. */
  cliRoot: string
}

export async function providerHarness(provider: string, opts: HarnessOptions): Promise<ProviderHarness> {
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
  const plugin = opts.registry.plugin(provider)
  if (!plugin) throw new Error(`no provider ${provider}`)
  for (const f of Object.values(plugin.credentials.fields)) set(f.env, undefined)
  const config = await Config.load(opts.cliRoot)
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
