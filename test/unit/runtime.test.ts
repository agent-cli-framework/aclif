import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import {AciBaseCommand} from '../../src/cli/base-command.js'
import type {AciMetadata} from '../../src/core/contract/aci.js'
import {AciRuntimeError} from '../../src/core/errors/runtime-error.js'
import {EventReporter} from '../../src/core/output/reporter.js'
import {StaticCredentialResolver} from '../../src/core/runtime/credential-resolver.js'
import type {Invocation} from '../../src/core/runtime/invocation.js'
import {Runtime} from '../../src/core/runtime/runtime.js'
import {builtinRegistry} from '../../src/providers/index.js'
import {assertEnvelope} from '../helpers/envelope.js'

/**
 * U-RT-1 to U-RT-5 against the built catalog (lib/), with EventReporter
 * so nothing reaches stdout. Synthetic behavior is injected by swapping
 * the loader of one catalog entry.
 */
let runtime: Runtime
const saved: Record<string, string | undefined> = {}
beforeAll(async () => {
  for (const k of Object.keys(process.env)) if (/^(SF_|SN_|ACLIF_|DOCUSIGN_|AGENTFORCE_|GOOGLE_)/.test(k)) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.OCLIF_TS_NODE = '0'
  runtime = await Runtime.start({cliRoot: process.cwd(), registry: builtinRegistry()})
})
afterAll(() => {
  runtime.stop()
  for (const [k, v] of Object.entries(saved)) process.env[k] = v
})

function invocation(argv: string[], over: Partial<Invocation> = {}): Invocation & {reporter: EventReporter} {
  return {
    argv,
    context: {requestId: 'r1'},
    credentials: new StaticCredentialResolver(new Map()),
    pool: runtime.pool,
    reporter: new EventReporter(),
    ...over,
  } as Invocation & {reporter: EventReporter}
}

const meta: AciMetadata = {mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 0, requiresConfirmation: false, prerequisites: []}

/** Replace the loader of a catalog entry for the duration of fn. */
async function withLoader(id: string, cls: unknown, fn: () => Promise<void>): Promise<void> {
  const entry = runtime.config.commands.find((c) => c.id === id)!
  const original = entry.load
  entry.load = (async () => cls) as typeof entry.load
  try {
    await fn()
  } finally {
    entry.load = original
  }
}

describe('U-RT-1 dispatch', () => {
  it('strips the leading bin name, appends --json, and resolves the longest command id', async () => {
    runtime.addManifestCommands('salesforce', [{
      id: 'salesforce:data',
      description: 'A manifest that shadows a topic prefix',
      aciMetadata: meta,
      request: {method: 'GET', path: '/services/data'},
      flags: {},
    }])
    const inv = invocation([runtime.config.bin, 'salesforce', 'data', 'query', '--schema'])
    const r = await runtime.run(inv)
    expect(r.exitCode, JSON.stringify(r.envelope)).toBe(0)
    expect(inv.argv).toEqual([runtime.config.bin, 'salesforce', 'data', 'query', '--schema'])
    const result = r.envelope.result as {command: string; flags: Record<string, unknown>}
    expect(result.command).toBe('salesforce:data:query')
    expect(result.flags).toHaveProperty('json')
    const shorter = await runtime.run(invocation(['salesforce', 'data', '--schema']))
    expect((shorter.envelope.result as {command: string}).command).toBe('salesforce:data')
  })

  it('returns COMMAND_NOT_FOUND with exit 2 for an unknown command', async () => {
    const r = await runtime.run(invocation(['nope', 'nothing']))
    expect(r).toMatchObject({success: false, exitCode: 2, errorCategory: 'invalid_usage'})
    expect(r.envelope.error).toMatchObject({code: 'COMMAND_NOT_FOUND', message: 'Unknown command: nope nothing --json'})
  })
})

describe('U-RT-2 errors', () => {
  it('passes AciRuntimeError through with its exit code', async () => {
    class Throws extends AciBaseCommand {
      static override id = 'discover'
      static override flags = {...AciBaseCommand.baseFlags}
      static override aciMetadata = meta
      async run(): Promise<void> {
        throw AciRuntimeError.of('CUSTOM', 'custom failure', {exitCode: 3, syntaxGuide: 'fix it'})
      }
    }
    await withLoader('discover', Throws, async () => {
      const r = await runtime.run(invocation(['discover']))
      expect(r).toMatchObject({exitCode: 3, errorCategory: 'auth_failure'})
      expect(r.envelope.error).toEqual({code: 'CUSTOM', message: 'custom failure', syntaxGuide: 'fix it'})
    })
  })

  it('maps an oclif flag error to COMMAND_INVOCATION_ERROR exit 2 and an unexpected throw to COMMAND_ERROR exit 1', async () => {
    const usage = await runtime.run(invocation(['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account', '--no-such-flag']))
    expect(usage).toMatchObject({exitCode: 2, errorCategory: 'invalid_usage'})
    expect(usage.envelope.error).toMatchObject({code: 'COMMAND_INVOCATION_ERROR', message: expect.stringContaining('--no-such-flag')})

    class Explodes extends AciBaseCommand {
      static override id = 'discover'
      static override flags = {...AciBaseCommand.baseFlags}
      static override aciMetadata = meta
      async run(): Promise<void> {
        throw new Error('kaboom')
      }
    }
    await withLoader('discover', Explodes, async () => {
      const r = await runtime.run(invocation(['discover']))
      expect(r).toMatchObject({exitCode: 1, errorCategory: 'api_error'})
      expect(r.envelope.error).toEqual({code: 'COMMAND_ERROR', message: 'kaboom'})
    })
  })

  it('this.error() and this.exit() inside a command become runtime errors instead of process exits', async () => {
    class Errors extends AciBaseCommand {
      static override id = 'discover'
      static override flags = {...AciBaseCommand.baseFlags}
      static override aciMetadata = meta
      async run(): Promise<void> {
        this.error('bad input for $BIN', {exit: 2, code: 'BAD_INPUT'})
      }
    }
    await withLoader('discover', Errors, async () => {
      const r = await runtime.run(invocation(['discover']))
      expect(r.exitCode).toBe(2)
      expect(r.envelope.error).toEqual({code: 'BAD_INPUT', message: `bad input for ${runtime.config.bin}`})
    })
  })
})

describe('U-RT-3 capability gate', () => {
  it('denies with exit 3 without loading the command class, and turns a throwing gate into CAPABILITY_GATE_ERROR', async () => {
    const entry = runtime.config.commands.find((c) => c.id === 'salesforce:data:query')!
    const load = vi.spyOn(entry, 'load')
    const gate = vi.fn(async (cmd: {commandId: string; aciMetadata: AciMetadata}) => ({allowed: false, error: {code: 'DENIED', message: `no ${cmd.commandId} for you`}}))
    const denied = await runtime.run(invocation(['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account'], {hooks: {capabilityGate: gate as never}}))
    expect(denied).toMatchObject({exitCode: 3, errorCategory: 'auth_failure'})
    expect(denied.envelope.error).toEqual({code: 'DENIED', message: 'no salesforce:data:query for you'})
    expect(load).not.toHaveBeenCalled()
    expect(gate.mock.calls[0][0]).toMatchObject({commandId: 'salesforce:data:query', aciMetadata: {mutability: 'read'}, argv: ['--query', 'SELECT Id FROM Account', '--json']})
    load.mockRestore()

    const generic = await runtime.run(invocation(['salesforce', 'data', 'query', '--query', 'x'], {hooks: {capabilityGate: async () => ({allowed: false})}}))
    expect(generic.envelope.error).toMatchObject({code: 'CAPABILITY_DENIED'})

    const throwing = await runtime.run(invocation(['salesforce', 'data', 'query', '--query', 'x'], {hooks: {capabilityGate: async () => {
      throw new Error('gate down')
    }}}))
    expect(throwing).toMatchObject({exitCode: 1})
    expect(throwing.envelope.error).toEqual({code: 'CAPABILITY_GATE_ERROR', message: 'gate down'})

    const runtimeErr = await runtime.run(invocation(['salesforce', 'data', 'query', '--query', 'x'], {hooks: {capabilityGate: async () => {
      throw AciRuntimeError.of('QUOTA', 'over quota', {exitCode: 3})
    }}}))
    expect(runtimeErr.exitCode).toBe(3)
    expect(runtimeErr.envelope.error).toEqual({code: 'QUOTA', message: 'over quota'})
  })
})

describe('U-RT-4 log override', () => {
  it('routes envelopes to result or error, bare JSON to result, and text to log events', async () => {
    class Logs extends AciBaseCommand {
      static override id = 'discover'
      static override flags = {...AciBaseCommand.baseFlags}
      static override aciMetadata = meta
      async run(): Promise<void> {
        this.log('starting $BIN')
        this.log(JSON.stringify({plain: true}))
        this.log(undefined)
        await this.outputResult({rows: [1, 2]}, this.buildContext({returned: 2}))
      }
    }
    await withLoader('discover', Logs, async () => {
      const inv = invocation(['discover'])
      const r = await runtime.run(inv)
      expect(r.exitCode).toBe(0)
      expect(r.envelope.result).toEqual({rows: [1, 2]})
      expect(r.envelope._context).toMatchObject({pagination: {returned: 2}})
      assertEnvelope({success: true, result: r.envelope.result, _context: r.envelope._context})
      expect(inv.reporter.events.map((e) => e.type)).toEqual(['log', 'result', 'result'])
      expect(inv.reporter.events[0]).toMatchObject({type: 'log', level: 'info', message: `starting ${runtime.config.bin}`})
      expect(inv.reporter.events[1]).toMatchObject({type: 'result', data: {plain: true}})
    })

    class Fails extends AciBaseCommand {
      static override id = 'discover'
      static override flags = {...AciBaseCommand.baseFlags}
      static override aciMetadata = meta
      async run(): Promise<void> {
        this.outputError({code: 'SOFT_FAIL', message: 'reported, not thrown'})
      }
    }
    await withLoader('discover', Fails, async () => {
      const r = await runtime.run(invocation(['discover']))
      expect(r.exitCode).toBe(0)
      expect(r.envelope).toMatchObject({success: false, error: {code: 'SOFT_FAIL'}})
    })
  })
})

describe('U-RT-5 health recording', () => {
  it('records provider outcomes, counts success:false with exit 0 as a failure, and ignores top-level commands', async () => {
    const before = runtime.healthMonitor.getHealth('salesforce')!
    const r = await runtime.run(invocation(['salesforce', 'data', 'query', '--query', 'SELECT Id FROM Account']))
    expect(r.exitCode).toBe(3)
    expect(r.envelope.error).toMatchObject({code: 'NO_CREDENTIALS'})
    const after = runtime.healthMonitor.getHealth('salesforce')!
    expect(after.totalFailures).toBe(before.totalFailures + 1)
    expect(after.lastError).toMatchObject({code: 'NO_CREDENTIALS'})

    class Soft extends AciBaseCommand {
      static override id = 'servicenow:data:query'
      static override flags = {...AciBaseCommand.baseFlags}
      static override aciMetadata = meta
      async run(): Promise<void> {
        this.outputError({code: 'SOFT', message: 'soft'})
      }
    }
    await withLoader('servicenow:data:query', Soft, async () => {
      const soft = await runtime.run(invocation(['servicenow', 'data', 'query']))
      expect(soft.exitCode).toBe(0)
      expect(runtime.healthMonitor.getHealth('servicenow')?.lastError).toMatchObject({code: 'SOFT', message: 'soft'})
    })
    class Ok extends Soft {
      async run(): Promise<void> {
        await this.outputResult({ok: true})
      }
    }
    await withLoader('servicenow:data:query', Ok, async () => {
      await runtime.run(invocation(['servicenow', 'data', 'query']))
      expect(runtime.healthMonitor.getHealth('servicenow')).toMatchObject({status: 'healthy', consecutiveFailures: 0})
    })

    const discover = await runtime.run(invocation(['discover']))
    expect(discover.exitCode).toBe(0)
    expect(runtime.healthMonitor.getHealth('discover')).toBeNull()
    expect(runtime.healthMonitor.getAllHealth().map((h) => h.provider)).not.toContain('discover')
  })
})
