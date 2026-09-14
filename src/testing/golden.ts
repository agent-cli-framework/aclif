// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Golden introspection capture and check.
 *
 * Runs every command of a CLI with every introspection flag and writes the
 * JSON output to <goldenDir>/<provider>/<topic>/<command>/<flag>.json (the
 * command id split on ':'; colons are not valid in Windows paths). In check
 * mode it compares instead of writing and reports changed, missing, stale,
 * and failed cases. The golden files document a CLI's Agent Command
 * Interface as it exists today; an unintended change shows up as a diff.
 *
 * Commands run in-process through oclif's Config.runCommand with the
 * environment scrubbed, because spawning a binary hundreds of times is too
 * slow on Windows runners. The introspection handlers write the same bytes
 * in both hosts.
 */
import {Config} from '@oclif/core'
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {runInProcess, scrubEnv} from './run.js'

/** File stem → argv appended to the command. */
export const INTROSPECTION_FLAGS: Record<string, string[]> = {
  schema: ['--schema'],
  examples: ['--examples'],
  shape: ['--shape'],
  changelog: ['--changelog'],
  discover: ['--discover'],
  'flags-for-auth': ['--flags-for', 'auth'],
  estimate: ['--estimate'],
}

/** Commands that do not implement the introspection flags. Empty: `learn` implements them through the base command. */
export const NO_INTROSPECTION = new Set<string>()

/**
 * Every command id of the CLI under test, sorted. Excludes commands
 * contributed by oclif plugins (help, plugins) and `<provider>:base`.
 */
export function listCommandIds(config: Config): string[] {
  return config.commands
    .filter((c) => c.pluginName === config.pjson.name)
    .map((c) => c.id)
    .filter((id) => !id.endsWith(':base') && !NO_INTROSPECTION.has(id))
    .sort()
}

export function goldenPath(goldenDir: string, id: string, flag: string): string {
  return join(goldenDir, ...id.split(':'), `${flag}.json`)
}

/** Canonical form: parsed and re-serialized with two-space indent. */
export function normalize(json: string): string {
  return JSON.stringify(JSON.parse(json), null, 2) + '\n'
}

/** Read a golden file, tolerating CRLF from a checkout that converted line endings. */
export async function readGolden(file: string): Promise<string> {
  return (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
}

/** Command ids that have golden files on disk: every directory holding a .json file. */
export async function goldenIds(goldenDir: string): Promise<string[]> {
  const ids: string[] = []
  async function walk(dir: string, segments: string[]): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, {withFileTypes: true})
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name.endsWith('.json'))) ids.push(segments.join(':'))
    for (const e of entries) if (e.isDirectory()) await walk(join(dir, e.name), [...segments, e.name])
  }
  await walk(goldenDir, [])
  return ids.sort()
}

export interface CaptureResult {
  commands: number
  cases: number
  written: string[]
  changed: string[]
  missing: string[]
  stale: string[]
  failed: string[]
}

export interface CaptureOptions {
  /** Package root of the CLI under test. */
  cliRoot: string
  /** Directory holding the golden files. */
  goldenDir: string
  /** Compare against the files instead of writing them. */
  check: boolean
  /** Command ids to run; defaults to every command of the CLI. */
  ids?: string[]
}

export async function captureGoldens(opts: CaptureOptions): Promise<CaptureResult> {
  const home = await mkdtemp(join(tmpdir(), 'aclif-golden-'))
  const restore = scrubEnv(home)
  const result: CaptureResult = {
    commands: 0,
    cases: 0,
    written: [],
    changed: [],
    missing: [],
    stale: [],
    failed: [],
  }

  try {
    const config = await Config.load(opts.cliRoot)
    const ids = opts.ids ?? listCommandIds(config)
    result.commands = ids.length

    for (const id of ids) {
      for (const [flag, flagArgv] of Object.entries(INTROSPECTION_FLAGS)) {
        result.cases++
        const label = `${id} ${flagArgv.join(' ')}`
        const out = await runInProcess(config, id, flagArgv)
        let body: string
        try {
          if (out.code !== 0) throw new Error(`exit ${out.code}: ${out.stderr.trim().slice(0, 300)}`)
          body = normalize(out.stdout)
        } catch (err) {
          result.failed.push(`${label}: ${(err as Error).message}`)
          continue
        }
        const file = goldenPath(opts.goldenDir, id, flag)
        if (opts.check) {
          let existing: string
          try {
            existing = await readGolden(file)
          } catch {
            result.missing.push(label)
            continue
          }
          if (existing !== body) result.changed.push(label)
        } else {
          await mkdir(dirname(file), {recursive: true})
          await writeFile(file, body)
          result.written.push(file)
        }
      }
    }

    if (opts.check) {
      const known = new Set(ids)
      result.stale = (await goldenIds(opts.goldenDir)).filter((id) => !known.has(id))
    }
  } finally {
    restore()
    await rm(home, {recursive: true, force: true})
  }
  return result
}
