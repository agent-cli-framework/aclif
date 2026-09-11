// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * ProbeTimer: background health probes for the embedded aclif runtime.
 *
 * For each registered provider with a probe configured, the timer fires a
 * cheap, idempotent command on a configurable interval. The probe runs only
 * if the provider has been idle (no real traffic AND no probe) for at least
 * the configured interval — busy providers don't pay the extra cost.
 *
 * Probes use the same Runtime.run() path as user requests, so the result
 * (success or failure) automatically feeds the HealthMonitor via the
 * normal recording flow. The probe invocation carries a marker on its
 * context.metadata so audit forwarders can filter probes out of user logs.
 */

import type {Runtime} from './runtime.js'
import type {Invocation} from './invocation.js'
import type {Reporter} from '../output/reporter.js'
import type {CredentialResolver} from './credential-resolver.js'
import {EventReporter} from '../output/reporter.js'

/**
 * Per-provider probe configuration. The runtime hosts (gateway, CLI binary,
 * tests) register one of these for each provider whose health they want
 * monitored.
 */
export interface ProbeConfig {
  provider: string
  /** Probe argv as it would be typed at the CLI, e.g. ['salesforce','data','query','--query','SELECT Id FROM Organization LIMIT 1'] */
  argv: string[]
  /** Credential resolver to use for the probe (typically a host-supplied shared resolver) */
  credentials: CredentialResolver
  /** Interval in milliseconds between probes (default: 60s) */
  intervalMs?: number
  /** If true, run the probe immediately when registered */
  probeOnStartup?: boolean
}

const DEFAULT_INTERVAL_MS = 60_000

export class ProbeTimer {
  private timers = new Map<string, NodeJS.Timeout>()
  private configs = new Map<string, Required<ProbeConfig>>()
  private inFlight = new Set<string>()
  private stopped = false

  constructor(private readonly runtime: Runtime) {}

  /**
   * Register a provider probe and start its periodic timer.
   */
  register(config: ProbeConfig): void {
    if (this.stopped) {
      throw new Error('ProbeTimer is stopped — register before calling stop()')
    }

    const full: Required<ProbeConfig> = {
      provider: config.provider,
      argv: config.argv,
      credentials: config.credentials,
      intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
      probeOnStartup: config.probeOnStartup ?? true,
    }

    this.configs.set(full.provider, full)
    this.runtime.healthMonitor.setProbeEnabled(full.provider, true)

    // Schedule the periodic timer
    const timer = setInterval(() => this.tick(full.provider), full.intervalMs)
    // Don't keep the Node event loop alive just for probes
    timer.unref()
    this.timers.set(full.provider, timer)

    // Optionally fire one immediately (off the call stack so register() returns first)
    if (full.probeOnStartup) {
      setImmediate(() => this.tick(full.provider))
    }
  }

  /**
   * Manually fire a probe for a provider, regardless of last-activity.
   * Used for "test connection" buttons and similar.
   */
  async probeNow(provider: string): Promise<void> {
    const config = this.configs.get(provider)
    if (!config) {
      throw new Error(`No probe configured for provider: ${provider}`)
    }
    return this.runProbe(config)
  }

  /**
   * Stop all probe timers and prevent further registrations.
   */
  stop(): void {
    this.stopped = true
    for (const timer of this.timers.values()) {
      clearInterval(timer)
    }
    this.timers.clear()
  }

  // ── Internal ──────────────────────────────────────────────────────

  /**
   * One scheduled tick for a single provider. Runs the probe only if the
   * provider has been idle for >= intervalMs.
   */
  private async tick(provider: string): Promise<void> {
    const config = this.configs.get(provider)
    if (!config) return
    if (this.inFlight.has(provider)) return // Don't pile up if a previous tick is still running

    const lastActivity = this.runtime.healthMonitor.lastActivityAt(provider)
    const now = Date.now()
    if (lastActivity && now - lastActivity < config.intervalMs) {
      // Provider has been busy — no need to probe
      return
    }

    await this.runProbe(config)
  }

  /**
   * Actually run the probe through the runtime.
   */
  private async runProbe(config: Required<ProbeConfig>): Promise<void> {
    if (this.inFlight.has(config.provider)) return
    this.inFlight.add(config.provider)

    try {
      const reporter: Reporter = new EventReporter()
      const invocation: Invocation = {
        argv: config.argv,
        context: {
          requestId: `probe-${config.provider}-${Date.now()}`,
          metadata: {probe: true},
        },
        credentials: config.credentials,
        pool: this.runtime.pool,
        reporter,
      }

      // Runtime.run() automatically updates the HealthMonitor via the
      // recording wrapper installed in runtime.ts. We don't need to record
      // success/failure here ourselves.
      await this.runtime.run(invocation)
      this.runtime.healthMonitor.recordProbe(config.provider)
    } catch (err) {
      // Defensive — runtime.run() shouldn't throw, but if it does, record
      // it as a failure so the UI reflects the issue.
      this.runtime.healthMonitor.recordFailure(config.provider, {
        code: 'PROBE_ERROR',
        message: err instanceof Error ? err.message : String(err),
      })
      this.runtime.healthMonitor.recordProbe(config.provider)
    } finally {
      this.inFlight.delete(config.provider)
    }
  }
}
