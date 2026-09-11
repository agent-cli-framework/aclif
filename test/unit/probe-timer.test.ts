import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {ConnectionPool} from '../../src/core/runtime/connection-pool.js'
import {HealthMonitor} from '../../src/core/runtime/health-monitor.js'
import {ProbeTimer} from '../../src/core/runtime/probe-timer.js'
import {StaticCredentialResolver} from '../../src/core/runtime/credential-resolver.js'
import type {Runtime} from '../../src/core/runtime/runtime.js'

/** U-PROBE-1 with fake timers and a fake runtime. */
function fakeRuntime(run = vi.fn(async () => ({success: true, exitCode: 0, envelope: {success: true}}))) {
  const runtime = {healthMonitor: new HealthMonitor(), pool: new ConnectionPool(), run} as unknown as Runtime
  return {runtime, run}
}
const credentials = new StaticCredentialResolver(new Map())

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('U-PROBE-1 ProbeTimer', () => {
  it('probes on startup when asked and records the probe', async () => {
    const {runtime, run} = fakeRuntime()
    const timer = new ProbeTimer(runtime)
    timer.register({provider: 'acme', argv: ['acme', 'ping'], credentials, intervalMs: 1000})
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    expect((run.mock.calls as unknown[][])[0][0]).toMatchObject({argv: ['acme', 'ping'], context: {metadata: {probe: true}}})
    expect(runtime.healthMonitor.getHealth('acme')).toMatchObject({probesEnabled: true})
    expect(runtime.healthMonitor.getHealth('acme')?.lastProbeAt).not.toBeNull()
    timer.stop()
  })

  it('does not probe while the provider is busy, probes after an idle interval, and stops cleanly', async () => {
    const {runtime, run} = fakeRuntime()
    const timer = new ProbeTimer(runtime)
    timer.register({provider: 'acme', argv: ['acme', 'ping'], credentials, intervalMs: 1000, probeOnStartup: false})
    await vi.advanceTimersByTimeAsync(500)
    runtime.healthMonitor.recordSuccess('acme', 3)
    await vi.advanceTimersByTimeAsync(500)
    expect(run, 'a tick within the interval of the last activity must not probe').not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run, 'the next tick after an idle interval probes').toHaveBeenCalledTimes(1)
    timer.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(() => timer.register({provider: 'b', argv: [], credentials})).toThrow(/stopped/)
  })

  it('guards in-flight probes and records a failure when the probe throws', async () => {
    let release: () => void = () => {}
    const run = vi.fn(() => new Promise<{success: boolean; exitCode: number; envelope: {success: boolean}}>((r) => {
      release = () => r({success: true, exitCode: 0, envelope: {success: true}})
    }))
    const {runtime} = fakeRuntime(run as never)
    const timer = new ProbeTimer(runtime)
    timer.register({provider: 'acme', argv: ['acme', 'ping'], credentials, intervalMs: 100, probeOnStartup: false})
    const first = timer.probeNow('acme')
    await vi.advanceTimersByTimeAsync(350)
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await first
    await expect(timer.probeNow('nope')).rejects.toThrow(/No probe configured/)
    timer.stop()

    const failing = fakeRuntime(vi.fn(async () => {
      throw new Error('probe exploded')
    }) as never)
    const t2 = new ProbeTimer(failing.runtime)
    t2.register({provider: 'acme', argv: [], credentials, probeOnStartup: false})
    await t2.probeNow('acme')
    expect(failing.runtime.healthMonitor.getHealth('acme')?.lastError).toMatchObject({code: 'PROBE_ERROR', message: 'probe exploded'})
    t2.stop()
  })
})
