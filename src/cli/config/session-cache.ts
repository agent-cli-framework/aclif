// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * File-backed SessionCache: <cacheDir>/sessions/<provider>/<instanceKey>.json
 * at 0600. Embedded hosts never use it; their pool is the cache.
 */
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {rmSync} from 'node:fs'
import {join} from 'node:path'

import type {SessionCache, SessionEntry, SessionSnapshot} from '../../core/credentials/session-cache.js'

export class FileSessionCache implements SessionCache {
  constructor(private readonly cacheDir: string) {}

  private root(): string {
    return join(this.cacheDir, 'sessions')
  }

  path(provider: string, instanceKey: string): string {
    return join(this.root(), provider, `${instanceKey}.json`)
  }

  async load(provider: string, instanceKey: string): Promise<SessionEntry | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.path(provider, instanceKey), 'utf8')) as SessionEntry
      return entry && typeof entry === 'object' && entry.state && typeof entry.state === 'object' ? entry : undefined
    } catch {
      return undefined
    }
  }

  async save(provider: string, instanceKey: string, snapshot: SessionSnapshot): Promise<void> {
    const entry: SessionEntry = {provider, instanceKey, savedAt: new Date().toISOString(), ...snapshot}
    await mkdir(join(this.root(), provider), {recursive: true, mode: 0o700})
    await writeFile(this.path(provider, instanceKey), JSON.stringify(entry, null, 2) + '\n', {mode: 0o600})
  }

  async clear(provider?: string, instanceKey?: string): Promise<number> {
    if (provider && instanceKey) {
      try {
        await rm(this.path(provider, instanceKey))
        return 1
      } catch {
        return 0
      }
    }
    const entries = (await this.list()).filter((e) => !provider || e.provider === provider)
    for (const e of entries) await rm(this.path(e.provider, e.instanceKey), {force: true})
    return entries.length
  }

  /** Synchronous removal for use inside error mapping. */
  clearSync(provider: string, instanceKey: string): void {
    rmSync(this.path(provider, instanceKey), {force: true})
  }

  async list(): Promise<SessionEntry[]> {
    const out: SessionEntry[] = []
    let providers: string[]
    try {
      providers = await readdir(this.root())
    } catch {
      return out
    }
    for (const provider of providers) {
      let files: string[]
      try {
        files = await readdir(join(this.root(), provider))
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        const entry = await this.load(provider, f.slice(0, -5))
        if (entry) out.push(entry)
      }
    }
    return out.sort((a, b) => `${a.provider}${a.instanceKey}`.localeCompare(`${b.provider}${b.instanceKey}`))
  }
}
