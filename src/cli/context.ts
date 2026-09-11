// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Resolve the CommandContext once per process: read the config file,
 * apply the selected profile to the environment, resolve identity through
 * the configured provider, and attach the result to the oclif Config.
 * Idempotent, so the init and prerun hooks can both call it (oclif runs
 * init only from the binary entry point, prerun also from
 * Config.runCommand). Never runs embedded, so the environment mutation
 * stays a standalone-only side effect.
 */

/** `--profile <name>`, `--profile=<name>`, or the profile env var (ACLIF_PROFILE, or the CLI's scoped name once applyScopedEnv ran). */
export function profileNameFromArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const idx = argv.indexOf('--profile')
  if (idx !== -1) return argv[idx + 1]
  const eq = argv.find((a) => a.startsWith('--profile='))
  return eq ? eq.slice('--profile='.length) : env.ACLIF_PROFILE
}

import type {Interfaces} from '@oclif/core'

import {getCommandContext, setCommandContext, type CommandContext} from '../core/command-context.js'
import {createIdentityProvider} from '../core/identity/index.js'
import {getRegistry} from '../core/provider/registry.js'
import {applyProfileToEnv, loadConfigFile, resolvePolicy, selectProfile} from './config/profiles.js'

export async function ensureCommandContext(
  config: Interfaces.Config,
  argv: string[],
  warn: (message: string) => void = (m) => process.stderr.write(`Warning: ${m}\n`),
): Promise<CommandContext> {
  const existing = getCommandContext(config)
  if (existing) return existing

  const loaded = loadConfigFile(config.configDir)
  for (const w of loaded.warnings) warn(w)
  const selected = selectProfile(loaded, profileNameFromArgv(argv))
  if (selected) {
    const schemas = Object.fromEntries(getRegistry().entries().map((e) => [e.plugin.name, e.plugin.credentials]))
    for (const w of applyProfileToEnv(selected.name, selected.profile, schemas, process.env, {fileMode: loaded.mode, cwd: config.configDir})) warn(w)
  }
  const policy = resolvePolicy(loaded.config.policy, loaded.file)
  const provider = createIdentityProvider(loaded.config.identity?.provider ?? 'anonymous')
  const identity = await provider.resolve({argv, env: process.env})

  const context: CommandContext = {
    identity,
    identityProvider: provider.name,
    policy,
    configFile: loaded.exists ? loaded.file : undefined,
    profile: selected?.name,
  }
  setCommandContext(config, context)
  return context
}
