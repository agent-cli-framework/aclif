// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Secret sources for profile fields: a literal, or a reference resolved at
 * credential time so the config file need hold no secret at all.
 * See docs/CONFIGURATION.md, The config file.
 */
import {execSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {resolve} from 'node:path'

export type SecretSource = string | {env: string} | {file: string} | {exec: string}

export function isSecretSourceObject(v: unknown): v is Exclude<SecretSource, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const keys = Object.keys(v)
  return keys.length === 1 && ['env', 'file', 'exec'].includes(keys[0]) && typeof (v as Record<string, unknown>)[keys[0]] === 'string'
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv
  cwd?: string
  timeoutMs?: number
}

/** Resolve a source to its string value. Throws with a message that names the source, never the value. */
export function resolveSecretSource(value: SecretSource, opts: ResolveOptions = {}): string {
  if (typeof value === 'string') return value
  const env = opts.env ?? process.env
  if ('env' in value) {
    const v = env[value.env]
    if (v === undefined || v === '') throw new Error(`environment variable ${value.env} is not set`)
    return v
  }
  if ('file' in value) {
    const path = value.file.startsWith('~/') ? resolve(homedir(), value.file.slice(2)) : resolve(opts.cwd ?? process.cwd(), value.file)
    try {
      return readFileSync(path, 'utf8').replace(/\r?\n$/, '')
    } catch (err) {
      throw new Error(`cannot read secret file for {file: ${value.file}}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`)
    }
  }
  if ('exec' in value) {
    try {
      return execSync(value.exec, {
        env,
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 10_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      }).replace(/\r?\n$/, '')
    } catch (err) {
      const e = err as {status?: number; signal?: string; stderr?: string; message?: string}
      const why = e.signal === 'SIGTERM' ? 'timed out' : e.status !== undefined ? `exited ${e.status}` : (e.message ?? 'failed')
      const stderr = (e.stderr ?? '').toString().trim().split('\n')[0]
      throw new Error(`{exec: ${value.exec}} ${why}${stderr ? `: ${stderr}` : ''}`)
    }
  }
  throw new Error('unknown secret source')
}
