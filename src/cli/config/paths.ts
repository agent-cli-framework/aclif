// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * The config directory oclif will compute, derived without an oclif Config
 * so it can be used at module load (the explicit command target needs the
 * manifests before Config exists). Mirrors oclif: <BIN>_CONFIG_DIR, then
 * XDG_CONFIG_HOME, then LOCALAPPDATA on Windows, then ~/.config, plus the
 * dirname.
 */
import {homedir} from 'node:os'
import {join} from 'node:path'

export function standaloneConfigDir(bin: string, dirname: string, env: NodeJS.ProcessEnv = process.env): string {
  const scoped = env[`${bin.replaceAll('-', '_').toUpperCase()}_CONFIG_DIR`]
  if (scoped) return scoped
  const base = env.XDG_CONFIG_HOME || (process.platform === 'win32' && env.LOCALAPPDATA) || join(env.HOME || homedir(), '.config')
  return join(base, dirname)
}
