import {Config} from '@oclif/core'
import {beforeAll, describe, expect, it} from 'vitest'

import {AciBaseCommand} from '../../src/cli/base-command.js'
import type {AciMetadata} from '../../src/core/contract/aci.js'
import {CONTRACT_VERSION} from '../../src/core/contract/version.js'
import {maskSensitiveFields} from '../../src/core/output/masking.js'
import {assertEnvelope} from '../helpers/envelope.js'
import {json, runClass} from '../helpers/run-class.js'

/**
 * U-ENV-1 to U-ENV-4: the success envelope, --fields, --truncate, and
 * masking, driven through outputResult() on a synthetic command.
 */
const meta: AciMetadata = {
  mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 1, requiresConfirmation: false, prerequisites: [],
}
const records = [
  {id: 1, name: 'a', password: 'pw', nested: {apiKey: 'k', token: 42, note: 'x'}},
  {id: 2, name: 'b', password: 'pw2', nested: {apiKey: 'k2', token: 43, note: 'y'}},
  {id: 3, name: 'c', password: 'pw3', nested: {apiKey: 'k3', token: 44, note: 'z'}},
]

let payload: unknown = records
let withContext = true
class Emitter extends AciBaseCommand {
  static override id = 'acme:things:list'
  static override flags = {...AciBaseCommand.baseFlags}
  static override aciMetadata = meta
  async run(): Promise<void> {
    await this.outputResult(payload, withContext ? this.buildContext({returned: 3, total: 10, hasMore: true, nextCommand: '$BIN acme things list --offset 3'}) : undefined)
  }
}

let config: Config
beforeAll(async () => {
  process.env.OCLIF_TS_NODE = '0'
  config = await Config.load(process.cwd())
})

async function emit(argv: string[], data: unknown = records, ctx = true) {
  payload = data
  withContext = ctx
  const out = await runClass(config, Emitter, argv)
  expect(out.code, out.stderr).toBe(0)
  return assertEnvelope(json(out))
}

describe('U-ENV-1 envelope', () => {
  it('carries success, result, and a _context stamped with the contract version that validates against the schema', async () => {
    const env = await emit(['--json'])
    expect(env.success).toBe(true)
    expect(env._context).toMatchObject({contract: CONTRACT_VERSION, pagination: {returned: 3, total: 10, hasMore: true}})
    expect((env._context as {pagination: {nextCommand: string}}).pagination.nextCommand).toBe('aclif acme things list --offset 3')
  })

  it('always emits _context, with null pagination, when the command passes none', async () => {
    const env = await emit(['--json'], {ok: true}, false)
    expect(env._context).toEqual({contract: CONTRACT_VERSION, pagination: null, rateLimit: null, availableFields: [], refinements: [], relatedCommands: []})
  })

  it('an error envelope validates too, and an envelope missing _context or with a bad contract does not', () => {
    assertEnvelope({success: false, error: {code: 'NO_CREDENTIALS', message: 'x'}})
    expect(() => assertEnvelope({success: true, result: {}})).toThrow(/_context/)
    expect(() => assertEnvelope({success: true, result: {}, _context: {contract: 'v1', pagination: null, rateLimit: null, availableFields: [], refinements: [], relatedCommands: []}})).toThrow(/pattern/)
    expect(() => assertEnvelope({success: false, error: {code: 'lower', message: 'x'}})).toThrow(/pattern/)
    expect(() => assertEnvelope({success: true, result: {}, error: {code: 'X', message: ''}, _context: {contract: '1.0.0', pagination: null, rateLimit: null, availableFields: [], refinements: [], relatedCommands: []}})).toThrow()
  })
})

describe('U-ENV-2 --fields', () => {
  it('projects arrays, {records}, and single objects; passes non-objects through', async () => {
    expect((await emit(['--fields', 'id,name', '--json'])).result).toEqual([{id: 1, name: 'a'}, {id: 2, name: 'b'}, {id: 3, name: 'c'}])
    expect((await emit(['--fields', 'id', '--json'], {records, totalSize: 3})).result).toEqual({records: [{id: 1}, {id: 2}, {id: 3}], totalSize: 3})
    expect((await emit(['--fields', ' name , missing', '--json'], records[0])).result).toEqual({name: 'a'})
    expect((await emit(['--fields', 'id', '--json'], 'plain')).result).toBe('plain')
    expect((await emit(['--fields', 'id', '--json'], 7)).result).toBe(7)
  })
})

describe('U-ENV-3 --truncate', () => {
  it('slices arrays, marks {records} with _truncated, and is a no-op under the limit', async () => {
    expect(((await emit(['--truncate', '2', '--full', '--json'])).result as unknown[]).length).toBe(2)
    const wrapped = (await emit(['--truncate', '2', '--full', '--json'], {records, totalSize: 3})).result as {records: unknown[]; _truncated: unknown}
    expect(wrapped.records.length).toBe(2)
    expect(wrapped._truncated).toEqual({original: 3, returned: 2})
    const under = (await emit(['--truncate', '5', '--full', '--json'], {records})).result as {records: unknown[]; _truncated?: unknown}
    expect(under.records.length).toBe(3)
    expect(under._truncated).toBeUndefined()
    expect((await emit(['--truncate', '1', '--json'], {single: true})).result).toEqual({single: true})
  })
})

describe('U-ENV-4 masking', () => {
  it('masks sensitive string keys at any depth and leaves non-string values alone', () => {
    const masked = maskSensitiveFields({
      password: 'p', Secret: 's', accessToken: 't', api_key: 'k', apiKey: 'k', privateKey: 'pk', private_key: 'pk', Authorization: 'Bearer x', credentials: 'c',
      token: 5, nested: [{clientSecret: 'cs', keep: 'v', deeper: {refresh_token: 'r'}}], keep: 'v', nullish: null,
    }) as Record<string, unknown>
    for (const k of ['password', 'Secret', 'accessToken', 'api_key', 'apiKey', 'privateKey', 'private_key', 'Authorization', 'credentials']) expect(masked[k], k).toBe('****')
    expect(masked.token).toBe(5)
    expect(masked.keep).toBe('v')
    expect(masked.nullish).toBeNull()
    expect(masked.nested).toEqual([{clientSecret: '****', keep: 'v', deeper: {refresh_token: '****'}}])
    expect(maskSensitiveFields('password')).toBe('password')
    expect(maskSensitiveFields(undefined)).toBeUndefined()
  })

  it('applies by default in the envelope and is bypassed by --full', async () => {
    const masked = (await emit(['--json'])).result as typeof records
    expect(masked[0].password).toBe('****')
    expect(masked[0].nested).toEqual({apiKey: '****', token: 42, note: 'x'})
    const full = (await emit(['--full', '--json'])).result as typeof records
    expect(full[0].password).toBe('pw')
    expect(full[0].nested.apiKey).toBe('k')
  })
})
