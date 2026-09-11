// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Golden introspection capture and check.
 *
 * Runs every registered command with every introspection flag and writes
 * the JSON output to
 * test/contract/golden/<provider>/<topic>/<command>/<flag>.json (the
 * command id split on ':'; colons are not valid in Windows paths). In
 * --check mode it compares instead of writing and reports changed,
 * missing, stale, and failed cases. The golden files document the Agent
 * Command Interface as it exists today; any unintended change during the
 * refactor shows up as a diff here.
 *
 * Commands run in-process through oclif's Config.runCommand, with the
 * environment scrubbed and stdout captured, because spawning the binary
 * 665 times is too slow for the Windows CI runners. The introspection
 * handlers write the same bytes in both hosts; test/contract/binary.test.ts
 * proves that for a sample of commands by spawning the real binary.
 *
 * The environment is empty apart from PATH and a temporary HOME, so the
 * output reflects no credentials, no config file, and no identity.
 * OCLIF_TS_NODE=0 is set so a developer's NODE_ENV=development shell can
 * never make oclif load .ts sources instead of lib/.
 */
import {Config} from '@oclif/core'
import {spawn} from 'node:child_process'
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const GOLDEN_DIR = join(ROOT, 'test', 'contract', 'golden')

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

// ── Environment ─────────────────────────────────────────────────────

export function cleanEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    OCLIF_TS_NODE: '0',
    ...extra,
  }
  if (process.platform === 'win32') {
    env.USERPROFILE = home
    env.LOCALAPPDATA = join(home, 'AppData', 'Local')
    env.APPDATA = join(home, 'AppData', 'Roaming')
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'PATHEXT', 'COMSPEC']) {
      if (process.env[key]) env[key] = process.env[key]
    }
  }
  return env
}

/** Replace process.env with the clean set; returns a function that restores it. */
function scrubEnv(home: string): () => void {
  const saved = {...process.env}
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, cleanEnv(home))
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}

// ── Catalogue ───────────────────────────────────────────────────────

/**
 * Every command id of this package, sorted.
 *
 * Excludes commands contributed by @oclif/plugin-help and plugin-plugins,
 * and `<provider>:base`, the abstract base classes the pattern strategy
 * registers as commands because they live under src/commands. Neither is
 * part of the contract; the explicit command strategy drops the latter.
 */
export function listCommandIds(config: Config): string[] {
  return config.commands
    .filter((c) => c.pluginName === config.pjson.name)
    .map((c) => c.id)
    .filter((id) => !id.endsWith(':base') && !NO_INTROSPECTION.has(id))
    .sort()
}

// ── Running ─────────────────────────────────────────────────────────

export interface RunOutput {
  stdout: string
  stderr: string
  /** Exit code for the binary; 0 or 1 for in-process (1 when the command threw). */
  code: number | null
}

/** Run one command in-process with stdout captured. Callers scrub the env first. */
/** Run a thunk with stdout and stderr captured; oclif exit errors become the exit code. */
export async function captureRun(fn: () => Promise<unknown>): Promise<RunOutput> {
  const out: string[] = []
  const err: string[] = []
  const stdoutWrite = process.stdout.write
  const stderrWrite = process.stderr.write
  const capture = (sink: string[]) =>
    ((chunk: string | Uint8Array) => {
      sink.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write
  process.stdout.write = capture(out)
  process.stderr.write = capture(err)
  // Commands that report an error envelope set process.exitCode; read it
  // back as the exit code and restore the worker's own value.
  const savedExitCode = process.exitCode
  process.exitCode = undefined
  let code: number
  try {
    await fn()
    code = Number(process.exitCode ?? 0)
  } catch (e) {
    // Commands end introspection with this.exit(0); oclif raises that as an
    // ExitError carrying exit 0, which the binary treats as success.
    const exit = (e as {oclif?: {exit?: number}})?.oclif?.exit
    if (exit === 0) {
      code = 0
    } else {
      code = typeof exit === 'number' ? exit : 1
      err.push(e instanceof Error ? e.message : String(e))
    }
  } finally {
    process.stdout.write = stdoutWrite
    process.stderr.write = stderrWrite
    process.exitCode = savedExitCode
  }
  return {stdout: out.join(''), stderr: err.join(''), code}
}

export function runInProcess(config: Config, id: string, argv: string[]): Promise<RunOutput> {
  return captureRun(() => config.runCommand(id, argv))
}

/** Spawn the built binary directly (no shell) with the clean environment. */
export function runBinary(argv: string[], home: string, extra: NodeJS.ProcessEnv = {}, binPath = join(ROOT, 'bin', 'run.js')): Promise<RunOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...argv], {
      cwd: ROOT,
      env: cleanEnv(home, extra),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({stdout, stderr, code}))
  })
}

// ── Golden files ────────────────────────────────────────────────────

export function goldenPath(id: string, flag: string): string {
  return join(GOLDEN_DIR, ...id.split(':'), `${flag}.json`)
}

/** Canonical form: parsed and re-serialised with two-space indent. */
export function normalize(json: string): string {
  return JSON.stringify(JSON.parse(json), null, 2) + '\n'
}

/** Read a golden file, tolerating CRLF from a checkout that converted line endings. */
export async function readGolden(file: string): Promise<string> {
  return (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
}

/** Command ids that have golden files on disk: every directory holding a .json file. */
export async function goldenIds(): Promise<string[]> {
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
  await walk(GOLDEN_DIR, [])
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

export async function capture(opts: {check: boolean; ids?: string[]}): Promise<CaptureResult> {
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
    const config = await Config.load(ROOT)
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
        const file = goldenPath(id, flag)
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
      result.stale = (await goldenIds()).filter((id) => !known.has(id))
    }
  } finally {
    restore()
    await rm(home, {recursive: true, force: true})
  }
  return result
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const check = process.argv.includes('--check')
  // --exclude <provider>: leave one provider's commands out of the run, so a
  // fork can prove the upstream goldens are unchanged with its own provider
  // present (K-8).
  const excludeAt = process.argv.indexOf('--exclude')
  const exclude = excludeAt === -1 ? undefined : process.argv[excludeAt + 1]
  const ids = exclude
    ? Config.load(ROOT).then((config) => listCommandIds(config).filter((id) => !id.startsWith(`${exclude}:`)))
    : Promise.resolve(undefined)
  ids.then((only) => capture({check, ids: only})).then((r) => {
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
