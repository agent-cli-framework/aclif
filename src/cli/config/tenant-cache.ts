// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * File-backed TenantCache for the standalone binary:
 * <cacheDir>/tenant/<provider>/<instanceKey>.json, written 0600.
 * Embedded hosts supply their own TenantCache on the Invocation.
 */
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {validateTenantCatalog, type TenantCache, type TenantCatalog} from '../../core/provider/tenant.js'

export class FileTenantCache implements TenantCache {
  constructor(
    private readonly cacheDir: string,
    private readonly warn: (message: string) => void = (m) => process.stderr.write(`Warning: ${m}\n`),
  ) {}

  path(provider: string, instanceKey: string): string {
    return join(this.cacheDir, 'tenant', provider, `${instanceKey}.json`)
  }

  async load(provider: string, instanceKey: string): Promise<TenantCatalog | undefined> {
    const file = this.path(provider, instanceKey)
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      return undefined
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      const errors = validateTenantCatalog(parsed)
      if (errors.length) throw new Error(errors[0])
      return parsed as TenantCatalog
    } catch (err) {
      this.warn(`Ignoring corrupt tenant catalogue ${file}: ${(err as Error).message}`)
      return undefined
    }
  }

  async save(provider: string, instanceKey: string, catalog: TenantCatalog): Promise<void> {
    const file = this.path(provider, instanceKey)
    await mkdir(join(this.cacheDir, 'tenant', provider), {recursive: true, mode: 0o700})
    await writeFile(file, JSON.stringify(catalog, null, 2) + '\n', {mode: 0o600})
  }
}
