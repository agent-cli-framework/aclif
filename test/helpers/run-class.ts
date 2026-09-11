import type {Config} from '@oclif/core'

import {captureRun, type RunOutput} from '../../scripts/capture-golden.js'

export type {RunOutput}

/**
 * Run a command class that is not registered in the oclif catalogue the
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

export const json = <T = Record<string, unknown>>(out: RunOutput): T => {
  try {
    return JSON.parse(out.stdout) as T
  } catch (e) {
    throw new Error(`stdout is not JSON (exit ${out.code}):\n${out.stdout}\n${out.stderr}\n${(e as Error).message}`)
  }
}
