// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Reporter: structured output channel for ACI commands.
 *
 * Replaces direct calls to this.log() and process.stdout.write() inside
 * commands. Different hosts use different reporters:
 *   - StdoutReporter (CLI binary): writes the canonical JSON envelope to stdout
 *   - EventReporter (gateway runtime): collects results and events into typed
 *     objects that the gateway returns to its HTTP client
 */

import type {AciError, ResponseContext} from '../contract/aci.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AuditEvent {
  type: string
  timestamp: string
  command: string
  durationMs?: number
  success: boolean
  error?: {code: string; message: string}
  user?: {id: string; username: string}
  serviceAccount?: string
  [key: string]: unknown
}

export interface Reporter {
  /** Emit a successful command result with optional response context */
  result(data: unknown, context?: ResponseContext): void

  /** Emit a structured command error */
  error(err: AciError): void

  /** Emit an audit event (forwarded to the gateway audit log or stderr) */
  audit(event: AuditEvent): void

  /** Emit a free-form log entry */
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void

  /** Emit a progress update for long-running operations */
  progress(current: number, total: number, message?: string): void
}

/**
 * StdoutReporter writes the canonical JSON envelope to process.stdout — the
 * same format the standalone CLI binary has always emitted. Used by bin/run.js.
 */
export class StdoutReporter implements Reporter {
  private wroteResult = false

  result(data: unknown, context?: ResponseContext): void {
    const output: Record<string, unknown> = {success: true, result: data}
    if (context !== undefined) output._context = context
    process.stdout.write(JSON.stringify(output, null, 2) + '\n')
    this.wroteResult = true
  }

  error(err: AciError): void {
    const output = {success: false, error: err}
    process.stdout.write(JSON.stringify(output, null, 2) + '\n')
    this.wroteResult = true
  }

  audit(event: AuditEvent): void {
    process.stderr.write('[AUDIT] ' + JSON.stringify(event) + '\n')
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const line = meta ? `[${level.toUpperCase()}] ${message} ${JSON.stringify(meta)}` : `[${level.toUpperCase()}] ${message}`
    process.stderr.write(line + '\n')
  }

  progress(current: number, total: number, message?: string): void {
    const line = message ? `[PROGRESS] ${current}/${total} ${message}` : `[PROGRESS] ${current}/${total}`
    process.stderr.write(line + '\n')
  }
}

/**
 * Reporter event types collected by EventReporter for structured consumption
 * by the gateway runtime.
 */
export type ReporterEvent =
  | {type: 'result'; data: unknown; context?: ResponseContext}
  | {type: 'error'; err: AciError}
  | {type: 'audit'; event: AuditEvent}
  | {type: 'log'; level: LogLevel; message: string; meta?: Record<string, unknown>}
  | {type: 'progress'; current: number; total: number; message?: string}

export interface CommandEnvelope {
  success: boolean
  result?: unknown
  error?: AciError
  _context?: ResponseContext
  _events?: ReporterEvent[]
}

/**
 * EventReporter collects structured events from a single command execution.
 * The gateway uses .envelope() to get the standard CLI JSON shape, and .events
 * to forward audit/log/progress events to its own pipelines.
 */
export class EventReporter implements Reporter {
  readonly events: ReporterEvent[] = []
  private finalResult: unknown
  private finalContext: ResponseContext | undefined
  private finalError: AciError | undefined

  result(data: unknown, context?: ResponseContext): void {
    this.finalResult = data
    this.finalContext = context
    this.events.push({type: 'result', data, context})
  }

  error(err: AciError): void {
    this.finalError = err
    this.events.push({type: 'error', err})
  }

  audit(event: AuditEvent): void {
    this.events.push({type: 'audit', event})
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    this.events.push({type: 'log', level, message, meta})
  }

  progress(current: number, total: number, message?: string): void {
    this.events.push({type: 'progress', current, total, message})
  }

  /**
   * Build the canonical CLI JSON envelope from the collected events.
   * Includes _events for clients that want the structured event log; clients
   * that only want the success/error envelope can ignore it.
   */
  envelope(): CommandEnvelope {
    if (this.finalError) {
      return {success: false, error: this.finalError, _events: this.events}
    }
    const env: CommandEnvelope = {success: true, result: this.finalResult, _events: this.events}
    if (this.finalContext !== undefined) env._context = this.finalContext
    return env
  }

  /**
   * True when the command produced a result or error. Used by the runtime to
   * detect commands that ran but never reported anything.
   */
  hasOutput(): boolean {
    return this.finalResult !== undefined || this.finalError !== undefined
  }
}
