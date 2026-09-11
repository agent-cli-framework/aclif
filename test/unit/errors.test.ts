import {Config} from '@oclif/core'
import {beforeAll, describe, expect, it} from 'vitest'

import {AciBaseCommand} from '../../src/cli/base-command.js'
import type {AciError, AciMetadata} from '../../src/core/contract/aci.js'
import {classifyError, type ErrorClass} from '../../src/core/errors/classifier.js'
import {ExitCode} from '../../src/core/errors/exit-codes.js'
import {AciRuntimeError, exitCodeToCategory} from '../../src/core/errors/runtime-error.js'
import type {ProviderPlugin} from '../../src/core/provider/plugin.js'
import {classifySalesforceError, refineAggregateOrderByError} from '../../src/providers/native/salesforce/errors.js'

/** U-ERR-1 to U-ERR-3 and K-5. */
const meta: AciMetadata = {
  mutability: 'read', idempotent: true, reversible: false, blastRadius: 'single_record', apiCallsConsumed: 1, requiresConfirmation: false, prerequisites: [],
}

class Exposed extends AciBaseCommand {
  static override id = 'acme:x'
  static override flags = {...AciBaseCommand.baseFlags}
  static override aciMetadata = meta
  format(e: unknown, ctx?: {query?: string}): AciError {
    return this.formatError(e, ctx)
  }
  async run(): Promise<void> {}
}
class Hinted extends Exposed {
  static override provider = {
    name: 'acme',
    classifyError: (e: unknown) => (e instanceof Error && e.message.includes('hint me') ? {code: 'ACME_HINT', message: 'hinted', syntaxGuide: 'do this'} : undefined),
  } as unknown as ProviderPlugin
}

let config: Config
beforeAll(async () => {
  process.env.OCLIF_TS_NODE = '0'
  config = await Config.load(process.cwd())
})

describe('U-ERR-1 generic formatError', () => {
  it('maps Error, permission errors, and non-Error inputs; rethrows oclif exit errors', () => {
    const cmd = new Exposed([], config)
    expect(cmd.format(new Error('boom'))).toEqual({code: 'COMMAND_ERROR', message: 'boom'})
    expect(cmd.format(new Error('INSUFFICIENT_ACCESS: nope'))).toMatchObject({code: 'INSUFFICIENT_ACCESS', syntaxGuide: expect.stringContaining('--dry-run')})
    expect(cmd.format(new Error('You lack Permission on Account'))).toMatchObject({code: 'INSUFFICIENT_ACCESS'})
    expect(cmd.format('a string')).toEqual({code: 'UNKNOWN_ERROR', message: 'a string'})
    expect(cmd.format({odd: true})).toEqual({code: 'UNKNOWN_ERROR', message: '[object Object]'})
    const exit = Object.assign(new Error('exit'), {oclif: {exit: 3}})
    expect(() => cmd.format(exit)).toThrow(exit)
  })

  it('lets the provider hook win when it returns a value and falls through when it does not', () => {
    const cmd = new Hinted([], config)
    expect(cmd.format(new Error('please hint me'))).toEqual({code: 'ACME_HINT', message: 'hinted', syntaxGuide: 'do this'})
    expect(cmd.format(new Error('plain'))).toEqual({code: 'COMMAND_ERROR', message: 'plain'})
  })
})

describe('U-ERR-2 Salesforce aggregate alias refinement', () => {
  const query = 'SELECT AccountId, COUNT(Id) Cases FROM Case GROUP BY AccountId ORDER BY Cases DESC LIMIT 10'
  const err = "No such column 'Cases' on entity 'Case'"

  it('rewrites the alias to the aggregate expression', () => {
    const hint = refineAggregateOrderByError(err, query)
    expect(hint?.correctedValue).toBe('SELECT AccountId, COUNT(Id) Cases FROM Case GROUP BY AccountId ORDER BY COUNT(Id) DESC LIMIT 10')
    expect(hint?.syntaxGuide).toContain('ORDER BY COUNT(Id) DESC')
    const alias = refineAggregateOrderByError(err, query.replace('COUNT(Id) Cases', 'COUNT(Id) AS Cases'))
    expect(alias?.correctedValue).toContain('ORDER BY COUNT(Id) DESC')
  })

  it('returns undefined without a query, without an aggregate, when the alias is not in ORDER BY, and when the alias is not declared', () => {
    expect(refineAggregateOrderByError(err, undefined)).toBeUndefined()
    expect(refineAggregateOrderByError('Some other error', query)).toBeUndefined()
    expect(refineAggregateOrderByError(err, 'SELECT AccountId, Cases FROM Case ORDER BY Cases DESC')).toBeUndefined()
    expect(refineAggregateOrderByError(err, 'SELECT AccountId, COUNT(Id) Cases FROM Case GROUP BY AccountId ORDER BY AccountId')).toBeUndefined()
    expect(refineAggregateOrderByError(err, 'SELECT AccountId, COUNT(Id) FROM Case GROUP BY AccountId ORDER BY Cases DESC')).toBeUndefined()
  })

  it('classifySalesforceError surfaces the refinement through the provider hook', () => {
    const hint = classifySalesforceError(new Error(err), {query})
    expect(hint?.correctedValue).toContain('ORDER BY COUNT(Id) DESC')
    expect(classifySalesforceError('not an error')).toBeUndefined()
  })
})

describe('U-ERR-3 error classifier', () => {
  const table: Array<[string, ErrorClass]> = [
    ['Instance Hibernating, please wait', 'hibernating'],
    ['Please wait while we wake your instance', 'hibernating'],
    ['redirect to https://hi.service-now.com/wake', 'hibernating'],
    ['Request failed (401) Unauthorized', 'auth_failed'],
    ['Request failed (403)', 'auth_failed'],
    ['INSUFFICIENT_ACCESS: operation not allowed', 'auth_failed'],
    ['INVALID_SESSION_ID: Session expired or invalid', 'auth_failed'],
    ['Request failed (429)', 'rate_limited'],
    ['REQUEST_LIMIT_EXCEEDED: TotalRequests Limit exceeded', 'rate_limited'],
    ['Too Many Requests', 'rate_limited'],
    ['Request failed (500)', 'service_error'],
    ['Request failed (503) Service Unavailable', 'service_error'],
    ['<html><body>Please sign in</body></html>', 'auth_required'],
    ['<!DOCTYPE html><html><body>Login</body></html>', 'auth_required'],
    ["Unexpected token '<', \"<html>...\" is not valid JSON", 'hibernating'],
    ['connect ECONNREFUSED 127.0.0.1:443', 'network_error'],
    ['getaddrinfo EAI_AGAIN example.invalid', 'network_error'],
    ['fetch failed', 'network_error'],
    ['Unexpected end of JSON input is not valid JSON', 'parse_error'],
    ['JSON.parse: bad control character', 'parse_error'],
    ['something else entirely', 'unknown'],
  ]
  it.each(table)('%s → %s', (message, expected) => {
    expect(classifyError(message)).toBe(expected)
    expect(classifyError({message})).toBe(expected)
  })

  it('handles empty input and joins stdout and stderr', () => {
    expect(classifyError(undefined)).toBe('unknown')
    expect(classifyError('   ')).toBe('unknown')
    expect(classifyError({stderr: 'x', stdout: 'Request failed (429)'})).toBe('rate_limited')
  })
})

describe('K-5 exit code table', () => {
  it('is 0, 1, 2, 3 with categories, and AciRuntimeError carries a code', () => {
    expect(ExitCode).toEqual({SUCCESS: 0, API_ERROR: 1, INVALID_USAGE: 2, AUTH_FAILURE: 3})
    expect([0, 1, 2, 3, 130].map(exitCodeToCategory)).toEqual([undefined, 'api_error', 'invalid_usage', 'auth_failure', 'api_error'])
    const e = AciRuntimeError.of('X', 'msg', {exitCode: 3, syntaxGuide: 'g'})
    expect(e.exitCode).toBe(3)
    expect(e.aciError).toEqual({code: 'X', message: 'msg', syntaxGuide: 'g'})
    expect(new AciRuntimeError({error: {code: 'Y', message: 'm'}}).exitCode).toBe(1)
  })
})
