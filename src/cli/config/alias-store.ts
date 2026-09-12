// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Standalone AliasStore. Sets come from, in precedence order:
 *   1. files listed under `aliases:` in config.yaml (relative to the config dir)
 *   2. every JSON or YAML file in <configDir>/aliases/ (where `aliases import` copies to)
 *   3. the starter vocabulary shipped with the CLI, unless `aliases_starter: false`
 * Invalid files are skipped with a warning.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {isAbsolute, join, resolve} from 'node:path'
import * as yaml from 'js-yaml'

import {AliasResolver, validateAliasSet, type AliasSet, type AliasStore} from '../../core/alias/alias-set.js'
import {loadConfigFile} from './profiles.js'

// Loaded with require so no import attribute is needed under module Node16; scripts/copy-data.mjs ships src/data into lib/data.
export const STARTER_VOCABULARY = createRequire(import.meta.url)('../../data/canonical-vocabulary.json') as AliasSet

export interface LoadedAliasSet {
  set: AliasSet
  file: string
}

export function loadAliasSetFileSync(file: string): AliasSet {
  const raw = readFileSync(file, 'utf8')
  const parsed = (file.endsWith('.yaml') || file.endsWith('.yml') ? yaml.load(raw) : JSON.parse(raw)) as unknown
  const errors = validateAliasSet(parsed)
  if (errors.length) throw new Error(`${file}:\n  ${errors.join('\n  ')}`)
  return parsed as AliasSet
}

export function aliasesDir(configDir: string): string {
  return join(configDir, 'aliases')
}

export function loadStandaloneAliasSetsSync(configDir: string, warn: (message: string) => void): LoadedAliasSet[] {
  const out: LoadedAliasSet[] = []
  const seen = new Set<string>()
  const add = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    try {
      out.push({set: loadAliasSetFileSync(file), file})
    } catch (err) {
      warn(`Skipping alias set: ${(err as Error).message}`)
    }
  }
  let config: {aliases?: unknown; aliases_starter?: unknown} = {}
  try {
    config = loadConfigFile(configDir).config as typeof config
  } catch (err) {
    warn((err as Error).message)
  }
  const listed = Array.isArray(config.aliases) ? (config.aliases as unknown[]).filter((f): f is string => typeof f === 'string') : []
  for (const rel of listed) add(isAbsolute(rel) ? rel : resolve(configDir, rel))
  const dir = aliasesDir(configDir)
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) if (/\.(json|ya?ml)$/.test(f)) add(join(dir, f))
  }
  if (config.aliases_starter !== false) out.push({set: STARTER_VOCABULARY, file: '(built-in starter vocabulary)'})
  return out
}

export class FileAliasStore extends AliasResolver implements AliasStore {
  constructor(configDir: string, warn: (message: string) => void = () => {}) {
    let cached: AliasSet[] | undefined
    super(async () => (cached ??= loadStandaloneAliasSetsSync(configDir, warn).map((l) => l.set)))
  }
}
