// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Running commands under test: in-process through oclif with stdout and
 * stderr captured, or by spawning a built binary with a scrubbed
 * environment. Shared by the framework's own tests and by the conformance
 * suite a downstream CLI package runs over its providers.
 *
 * The environment is empty apart from PATH and a temporary HOME, so output
 * reflects no credentials, no config file, and no identity.
 *
 * Commands run from the compiled lib/, never from src/*.ts. Under vitest
 * NODE_ENV is "test", and oclif then maps lib/ back to src/ and tries to
 * register a TypeScript loader; a CLI package without tsx cannot load the
 * .ts files, and one with a ts-node in a parent directory fails the same
 * way. The flag on oclif's settings object is the only switch oclif reads
 * (OCLIF_TS_NODE is not), so importing this module turns it off.
 */
import {settings, type Config} from '@oclif/core'
import {spawn} from 'node:child_process'
import {dirname, join} from 'node:path'

settings.enableAutoTranspile = false
settings.tsnodeEnabled = false

export interface RunOutput {
  stdout: string
  stderr: string
  /** Exit code for the binary; 0 or 1 for in-process (1 when the command threw). */
  code: number | null
}

/** The clean environment a command runs in: PATH, a temporary HOME, and whatever `extra` adds. */
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
export function scrubEnv(home: string): () => void {
  const saved = {...process.env}
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, cleanEnv(home))
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}

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

/** Run a registered command through the oclif catalogue, so hooks apply. Callers scrub the env first. */
export function runInProcess(config: Config, id: string, argv: string[]): Promise<RunOutput> {
  return captureRun(() => config.runCommand(id, argv))
}

/**
 * Run a command class that may not be registered in the oclif catalogue the
 * way the embedded runtime does: construct, init, run. Introspection
 * short-circuits end with exit(0) inside init, so run() is never reached.
 */
export function runClass(
  config: Config,
  Cmd: new (argv: string[], config: Config) => {init(): Promise<void>; run(): Promise<unknown>},
  argv: string[],
): Promise<RunOutput> {
  return captureRun(async () => {
    const cmd = new Cmd(argv, config)
    await cmd.init()
    await cmd.run()
  })
}

/**
 * Spawn a built binary directly (no shell) with the clean environment.
 * `cwd` defaults to the package root, two levels above `bin/run.js`.
 */
export function runBinary(argv: string[], home: string, extra: NodeJS.ProcessEnv = {}, binPath: string, cwd = dirname(dirname(binPath))): Promise<RunOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...argv], {
      cwd,
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

/** Parse a run's stdout as JSON, with the exit code and stderr in the error when it is not JSON. */
export const json = <T = Record<string, unknown>>(out: RunOutput): T => {
  try {
    return JSON.parse(out.stdout) as T
  } catch (e) {
    throw new Error(`stdout is not JSON (exit ${out.code}):\n${out.stdout}\n${out.stderr}\n${(e as Error).message}`)
  }
}
