// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * HealthMonitor: per-provider health state for the embedded aclif runtime.
 *
 * Every command that flows through Runtime.run() reports its outcome here.
 * Optionally, a ProbeTimer fires cheap background calls when a provider has
 * been idle, to catch hibernation or auth-rotation events between user
 * requests.
 *
 * The monitor is process-local — single-tenant, single Runtime, no DB.
 */

import {classifyError, errorClassDescription, type ErrorClass} from '../errors/classifier.js'

export type HealthStatus =
  | 'healthy'      // Recent successful call(s)
  | 'degraded'     // Some failures but not yet unhealthy
  | 'unhealthy'    // Repeated failures
  | 'hibernating'  // Provider is hibernating
  | 'auth_failed'  // Provider rejected our credentials
  | 'rate_limited' // Provider is rate-limiting us
  | 'unknown'      // No data yet (cold start, no traffic)

export interface HealthSnapshot {
  provider: string
  status: HealthStatus
  statusReason: string             // Human-readable explanation of the current status
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: {
    code: string
    message: string
    classification: ErrorClass
  } | null
  totalSuccesses: number
  totalFailures: number
  consecutiveFailures: number
  consecutiveSuccesses: number
  p50LatencyMs: number | null
  p99LatencyMs: number | null
  errorRate1m: number              // Rolling 1-minute error rate (0-1)
  lastProbeAt: string | null       // When the background probe last ran (null if never)
  probesEnabled: boolean
}

interface ProviderState {
  provider: string
  status: HealthStatus
  statusReason: string
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastActivityAt: number | null    // Either success OR failure
  lastError: HealthSnapshot['lastError']
  totalSuccesses: number
  totalFailures: number
  consecutiveFailures: number
  consecutiveSuccesses: number
  /** Rolling buffer of recent latencies (success only), most recent first */
  latencies: number[]
  /** Rolling buffer of recent failure timestamps for error-rate calc */
  recentFailures: number[]
  /** Rolling buffer of recent success timestamps for error-rate calc */
  recentSuccesses: number[]
  lastProbeAt: number | null
  probesEnabled: boolean
}

export interface HealthMonitorOptions {
  /** Number of consecutive failures before status drops to 'degraded' */
  degradedThreshold?: number
  /** Number of consecutive failures before status drops to 'unhealthy' */
  unhealthyThreshold?: number
  /** Maximum latencies to retain per provider for percentile calculation */
  latencyBufferSize?: number
  /** Window for rolling error-rate calculation */
  errorRateWindowMs?: number
}

const DEFAULT_OPTIONS: Required<HealthMonitorOptions> = {
  degradedThreshold: 3,
  unhealthyThreshold: 5,
  latencyBufferSize: 100,
  errorRateWindowMs: 60_000,
}

export class HealthMonitor {
  private states = new Map<string, ProviderState>()
  private opts: Required<HealthMonitorOptions>

  constructor(opts: HealthMonitorOptions = {}) {
    this.opts = {...DEFAULT_OPTIONS, ...opts}
  }

  /**
   * Record a successful command. Updates rolling latency, resets failure
   * counters, and may move the status back to 'healthy'.
   */
  recordSuccess(provider: string, latencyMs: number): void {
    const state = this.getOrCreate(provider)
    const now = Date.now()

    state.lastSuccessAt = now
    state.lastActivityAt = now
    state.totalSuccesses++
    state.consecutiveSuccesses++
    state.consecutiveFailures = 0

    // Maintain latency rolling buffer (most recent first)
    state.latencies.unshift(latencyMs)
    if (state.latencies.length > this.opts.latencyBufferSize) {
      state.latencies.length = this.opts.latencyBufferSize
    }

    // Maintain success rolling buffer for error-rate calc
    state.recentSuccesses.push(now)
    this.pruneOlderThan(state.recentSuccesses, now - this.opts.errorRateWindowMs)
    this.pruneOlderThan(state.recentFailures, now - this.opts.errorRateWindowMs)

    // After a single success, restore status to healthy unless we're in a
    // sticky failure mode that requires more confirmation. We use a single
    // success to clear because the alternative (waiting for N successes)
    // delays recovery in the UI.
    state.status = 'healthy'
    state.statusReason = 'Operating normally'
  }

  /**
   * Record a failed command. Updates failure counters, classifies the error,
   * and may move the status to 'degraded' or 'unhealthy' (or a specific
   * failure mode like 'hibernating').
   */
  recordFailure(provider: string, error: {code?: string; message?: string} | string): void {
    const state = this.getOrCreate(provider)
    const now = Date.now()

    state.lastFailureAt = now
    state.lastActivityAt = now
    state.totalFailures++
    state.consecutiveFailures++
    state.consecutiveSuccesses = 0

    // Classify the error
    const errMsg = typeof error === 'string' ? error : (error.message || '')
    const errCode = typeof error === 'string' ? 'COMMAND_ERROR' : (error.code || 'COMMAND_ERROR')
    // The code carries the provider's verdict (RATE_LIMITED,
    // AUTHENTICATION_FAILED); the message carries the API's own words.
    const classification = classifyError(`${errCode} ${errMsg}`)

    state.lastError = {
      code: errCode,
      message: errMsg.slice(0, 500),
      classification,
    }

    // Maintain failure rolling buffer
    state.recentFailures.push(now)
    this.pruneOlderThan(state.recentSuccesses, now - this.opts.errorRateWindowMs)
    this.pruneOlderThan(state.recentFailures, now - this.opts.errorRateWindowMs)

    // Specific classifications take precedence over generic degraded/unhealthy
    if (classification === 'hibernating') {
      state.status = 'hibernating'
      state.statusReason = errorClassDescription.hibernating
    } else if (classification === 'auth_failed' || classification === 'auth_required') {
      state.status = 'auth_failed'
      state.statusReason = errorClassDescription[classification]
    } else if (classification === 'rate_limited') {
      state.status = 'rate_limited'
      state.statusReason = errorClassDescription.rate_limited
    } else if (state.consecutiveFailures >= this.opts.unhealthyThreshold) {
      state.status = 'unhealthy'
      state.statusReason = `${state.consecutiveFailures} consecutive failures`
    } else if (state.consecutiveFailures >= this.opts.degradedThreshold) {
      state.status = 'degraded'
      state.statusReason = `${state.consecutiveFailures} consecutive failures`
    } else {
      // Single failure — keep current status but note the error
      if (state.status === 'unknown' || state.status === 'healthy') {
        state.statusReason = errorClassDescription[classification] || 'Recent failure'
      }
    }
  }

  /**
   * Mark that a probe ran for this provider (used by ProbeTimer to drive
   * the "last probe" timestamp in the snapshot).
   */
  recordProbe(provider: string): void {
    const state = this.getOrCreate(provider)
    state.lastProbeAt = Date.now()
  }

  /**
   * Enable or disable background probing for a provider.
   */
  setProbeEnabled(provider: string, enabled: boolean): void {
    const state = this.getOrCreate(provider)
    state.probesEnabled = enabled
  }

  /**
   * Return the wall-clock timestamp (ms since epoch) of the last activity
   * for a provider — either a real request or a probe. Used by ProbeTimer
   * to decide when to fire a probe.
   */
  lastActivityAt(provider: string): number | null {
    const state = this.states.get(provider)
    if (!state) return null
    return Math.max(state.lastActivityAt || 0, state.lastProbeAt || 0) || null
  }

  /**
   * Get a snapshot of one provider's health.
   */
  getHealth(provider: string): HealthSnapshot | null {
    const state = this.states.get(provider)
    if (!state) return null
    return this.toSnapshot(state)
  }

  /**
   * Get snapshots of all providers the monitor has seen.
   */
  getAllHealth(): HealthSnapshot[] {
    return Array.from(this.states.values()).map((s) => this.toSnapshot(s))
  }

  /**
   * Pre-register a provider in 'unknown' state so the UI can show it
   * before any traffic flows. Called by Runtime.start().
   */
  register(provider: string): void {
    this.getOrCreate(provider)
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private getOrCreate(provider: string): ProviderState {
    let state = this.states.get(provider)
    if (!state) {
      state = {
        provider,
        status: 'unknown',
        statusReason: 'No traffic yet',
        lastSuccessAt: null,
        lastFailureAt: null,
        lastActivityAt: null,
        lastError: null,
        totalSuccesses: 0,
        totalFailures: 0,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        latencies: [],
        recentFailures: [],
        recentSuccesses: [],
        lastProbeAt: null,
        probesEnabled: false,
      }
      this.states.set(provider, state)
    }
    return state
  }

  private toSnapshot(state: ProviderState): HealthSnapshot {
    return {
      provider: state.provider,
      status: state.status,
      statusReason: state.statusReason,
      lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
      lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
      lastError: state.lastError,
      totalSuccesses: state.totalSuccesses,
      totalFailures: state.totalFailures,
      consecutiveFailures: state.consecutiveFailures,
      consecutiveSuccesses: state.consecutiveSuccesses,
      p50LatencyMs: this.percentile(state.latencies, 0.5),
      p99LatencyMs: this.percentile(state.latencies, 0.99),
      errorRate1m: this.errorRate(state),
      lastProbeAt: state.lastProbeAt ? new Date(state.lastProbeAt).toISOString() : null,
      probesEnabled: state.probesEnabled,
    }
  }

  private percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
    return sorted[idx]
  }

  private errorRate(state: ProviderState): number {
    const total = state.recentSuccesses.length + state.recentFailures.length
    if (total === 0) return 0
    return state.recentFailures.length / total
  }

  private pruneOlderThan(buffer: number[], cutoff: number): void {
    while (buffer.length > 0 && buffer[0] < cutoff) {
      buffer.shift()
    }
  }
}
