import {describe, expect, it} from 'vitest'

import {HealthMonitor} from '../../src/core/runtime/health-monitor.js'

/** U-HEALTH-1. */
describe('U-HEALTH-1 HealthMonitor', () => {
  it('starts unknown, turns healthy on success, then degraded and unhealthy on consecutive failures', () => {
    const m = new HealthMonitor({degradedThreshold: 2, unhealthyThreshold: 4})
    m.register('acme')
    expect(m.getHealth('acme')).toMatchObject({status: 'unknown', statusReason: 'No traffic yet', p50LatencyMs: null})
    m.recordSuccess('acme', 10)
    expect(m.getHealth('acme')).toMatchObject({status: 'healthy', totalSuccesses: 1, consecutiveSuccesses: 1})
    m.recordFailure('acme', new Error('boom'))
    expect(m.getHealth('acme')).toMatchObject({status: 'healthy', consecutiveFailures: 1, consecutiveSuccesses: 0})
    m.recordFailure('acme', 'boom again')
    expect(m.getHealth('acme')).toMatchObject({status: 'degraded', statusReason: '2 consecutive failures'})
    m.recordFailure('acme', {code: 'X', message: 'boom'})
    m.recordFailure('acme', {code: 'X', message: 'boom'})
    expect(m.getHealth('acme')).toMatchObject({status: 'unhealthy', statusReason: '4 consecutive failures', totalFailures: 4})
    expect(m.getHealth('acme')?.lastError).toEqual({code: 'X', message: 'boom', classification: 'unknown'})
    m.recordSuccess('acme', 5)
    expect(m.getHealth('acme')).toMatchObject({status: 'healthy', consecutiveFailures: 0})
  })

  it('classifies the first failure into hibernating, auth_failed, and rate_limited regardless of thresholds', () => {
    for (const [message, status] of [['Instance Hibernating', 'hibernating'], ['Request failed (401)', 'auth_failed'], ['<html>login</html>', 'auth_failed'], ['REQUEST_LIMIT_EXCEEDED', 'rate_limited']] as const) {
      const m = new HealthMonitor()
      m.recordSuccess('p', 1)
      m.recordFailure('p', {message})
      expect(m.getHealth('p')?.status, message).toBe(status)
    }
  })

  it('computes the error rate over the window and latency percentiles from the newest samples', () => {
    const m = new HealthMonitor({latencyBufferSize: 4})
    for (const l of [100, 1, 2, 3, 4]) m.recordSuccess('p', l)
    m.recordFailure('p', 'x')
    const h = m.getHealth('p')!
    expect(h.errorRate1m).toBeCloseTo(1 / 6)
    expect(h.p50LatencyMs).toBe(3)
    expect(h.p99LatencyMs).toBe(4)
    expect(m.getAllHealth().map((s) => s.provider)).toEqual(['p'])
    expect(m.getHealth('nope')).toBeNull()
  })

  it('records probes and activity for the probe timer', () => {
    const m = new HealthMonitor()
    expect(m.lastActivityAt('p')).toBeNull()
    m.register('p')
    expect(m.lastActivityAt('p')).toBeNull()
    m.recordProbe('p')
    expect(m.lastActivityAt('p')).toBeGreaterThan(0)
    m.setProbeEnabled('p', true)
    expect(m.getHealth('p')).toMatchObject({probesEnabled: true, status: 'unknown'})
    expect(m.getHealth('p')?.lastProbeAt).toMatch(/T/)
  })
})
