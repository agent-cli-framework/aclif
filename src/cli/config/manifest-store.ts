// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Standalone manifest source: the `manifests` section of config.yaml.
 *
 *   manifests:
 *     dev:                      # profile
 *       salesforce:             # provider
 *         - ./manifests/apex-quote-summary.json
 *
 * Paths resolve against the config directory. Files are JSON or YAML.
 * Invalid manifests are skipped with a warning so one bad file cannot
 * take the binary down.
 */
import {readFileSync} from 'node:fs'
import {isAbsolute, resolve} from 'node:path'
import yaml from 'js-yaml'

import {providerOf, validateManifest, type CommandManifest, type ManifestStore} from '../../core/manifest/manifest.js'
import {loadConfigFile, selectProfile} from './profiles.js'

export type ManifestSection = Record<string, Record<string, string[]>>

export interface LoadedManifest {
  manifest: CommandManifest
  file: string
}

export function loadManifestFileSync(file: string): CommandManifest {
  const raw = readFileSync(file, 'utf8')
  const parsed = (file.endsWith('.yaml') || file.endsWith('.yml') ? yaml.load(raw) : JSON.parse(raw)) as unknown
  const errors = validateManifest(parsed)
  if (errors.length) throw new Error(`${file}:\n  ${errors.join('\n  ')}`)
  return parsed as CommandManifest
}

/** Manifests declared for one profile, grouped by provider, with provenance. */
export function loadStandaloneManifestsSync(
  configDir: string,
  profileName: string | undefined,
  warn: (message: string) => void,
): Record<string, LoadedManifest[]> {
  const out: Record<string, LoadedManifest[]> = {}
  let loaded
  try {
    loaded = loadConfigFile(configDir)
  } catch (err) {
    warn((err as Error).message)
    return out
  }
  const section = (loaded.config as {manifests?: ManifestSection}).manifests
  if (!section) return out
  let profile: string | undefined
  try {
    profile = selectProfile(loaded, profileName)?.name ?? profileName ?? loaded.config.default_profile
  } catch {
    profile = profileName
  }
  if (!profile || !section[profile]) return out
  for (const [provider, files] of Object.entries(section[profile])) {
    for (const rel of files ?? []) {
      const file = isAbsolute(rel) ? rel : resolve(configDir, rel)
      try {
        const manifest = loadManifestFileSync(file)
        if (providerOf(manifest) !== provider) {
          warn(`Manifest ${file} has id '${manifest.id}' but is listed under provider '${provider}'; skipped`)
          continue
        }
        ;(out[provider] ??= []).push({manifest, file})
      } catch (err) {
        warn(`Skipping manifest: ${(err as Error).message}`)
      }
    }
  }
  return out
}

export class FileManifestStore implements ManifestStore {
  constructor(
    private readonly configDir: string,
    private readonly profileName: string | undefined,
    private readonly warn: (message: string) => void = () => {},
  ) {}

  async load(provider: string): Promise<CommandManifest[]> {
    return (loadStandaloneManifestsSync(this.configDir, this.profileName, this.warn)[provider] ?? []).map((m) => m.manifest)
  }
}
