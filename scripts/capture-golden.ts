// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Golden introspection capture and check for this repository: a thin
 * caller of `src/testing/golden.ts` with the framework's root and golden
 * directory bound. `npm run golden:capture` writes; `--check` compares.
 * `--exclude <provider>` leaves one provider out, so a fork can prove the
 * upstream goldens are unchanged with its own provider present (K-8).
 */
import {Config} from '@oclif/core'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

import {captureGoldens, goldenIds as ids, goldenPath as path, listCommandIds, type CaptureResult} from '../src/testing/golden.js'
import {runBinary as bin, type RunOutput} from '../src/testing/run.js'

export {INTROSPECTION_FLAGS, listCommandIds, NO_INTROSPECTION, normalize, readGolden, type CaptureResult} from '../src/testing/golden.js'
export {captureRun, cleanEnv, runInProcess, type RunOutput} from '../src/testing/run.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const GOLDEN_DIR = join(ROOT, 'test', 'contract', 'golden')

export const goldenPath = (id: string, flag: string): string => path(GOLDEN_DIR, id, flag)
export const goldenIds = (): Promise<string[]> => ids(GOLDEN_DIR)
export const runBinary = (argv: string[], home: string, extra: NodeJS.ProcessEnv = {}, binPath = join(ROOT, 'bin', 'run.js')): Promise<RunOutput> => bin(argv, home, extra, binPath, ROOT)
export const capture = (opts: {check: boolean; ids?: string[]}): Promise<CaptureResult> => captureGoldens({cliRoot: ROOT, goldenDir: GOLDEN_DIR, ...opts})

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const check = process.argv.includes('--check')
  const excludeAt = process.argv.indexOf('--exclude')
  const exclude = excludeAt === -1 ? undefined : process.argv[excludeAt + 1]
  const only = exclude
    ? Config.load(ROOT).then((config) => listCommandIds(config).filter((id) => !id.startsWith(`${exclude}:`)))
    : Promise.resolve(undefined)
  only.then((idsOnly) => capture({check, ids: idsOnly})).then((r) => {
    if (check) {
      console.log(`Checked ${r.cases} cases across ${r.commands} commands`)
      if (exclude) {
        // The root topic list legitimately grows by the excluded provider.
        const rootDiscover = r.changed.filter((c) => /^[^:\s]+ --discover$/.test(c))
        for (const c of rootDiscover) console.log(`expected with provider '${exclude}' present: ${c}`)
        r.changed = r.changed.filter((c) => !rootDiscover.includes(c))
      }
      for (const c of r.changed) console.log(`changed: ${c}`)
      for (const m of r.missing) console.log(`missing: ${m}`)
      for (const s of r.stale) console.log(`stale golden directory: ${s}`)
      for (const f of r.failed) console.log(`failed: ${f}`)
      process.exit(r.changed.length + r.missing.length + r.stale.length + r.failed.length ? 1 : 0)
    } else {
      console.log(`Wrote ${r.written.length} golden files for ${r.commands} commands`)
      for (const f of r.failed) console.log(`failed: ${f}`)
      process.exit(r.failed.length ? 1 : 0)
    }
  })
}
