import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {assertEnvelope} from '../../../helpers/envelope.js'
import {http, json, settle, startServer} from '../../../helpers/msw.js'
import {parse, providerHarness, type ProviderHarness} from '../../../helpers/provider-suite.js'

/**
 * `google gmail draft` over msw: the draft is created through drafts.create
 * with the RFC 2822 message, and a dry run makes no request.
 */
const DRAFTS = /\/gmail\/v1\/users\/me\/drafts$/

let h: ProviderHarness
const mock = startServer()

beforeAll(async () => {
  h = await providerHarness('google')
})
afterAll(async () => {
  mock.server.close()
  await h.close()
})
afterEach(async () => {
  mock.reset()
  await h.fresh()
})

const creds = () => h.setEnv({GW_ACCESS_TOKEN: 'gw-access'})
const decode = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

describe('P-google gmail draft', () => {
  it('saves the message as a draft and returns the draft and message ids', async () => {
    creds()
    mock.server.use(http.post(DRAFTS, () => json({id: 'r-100', message: {id: 'msg-1', threadId: 'thr-1', labelIds: ['DRAFT']}})))
    const out = await h.run('google:gmail:draft', ['--to', 'alice@example.com,bob@example.com', '--cc', 'carol@example.com', '--subject', 'Filing due Friday', '--body', 'The reply brief is due Friday.', '--json'])
    expect(out.code, out.stderr).toBe(0)
    await settle()
    const post = mock.seen.find((r) => r.method === 'POST' && DRAFTS.test(r.path))!
    expect(post.headers.authorization).toBe('Bearer gw-access')
    const body = JSON.parse(post.body) as {message: {raw: string}}
    const raw = decode(body.message.raw)
    expect(raw).toContain('To: alice@example.com,bob@example.com')
    expect(raw).toContain('Cc: carol@example.com')
    expect(raw).toContain('Subject: Filing due Friday')
    expect(raw).toContain(Buffer.from('The reply brief is due Friday.', 'utf8').toString('base64'))
    expect(mock.seen.some((r) => r.path.endsWith('/messages/send'))).toBe(false)
    expect(assertEnvelope(parse(out)).result).toEqual({id: 'r-100', messageId: 'msg-1', threadId: 'thr-1', labelIds: ['DRAFT']})
  })

  it('--dry-run makes no request', async () => {
    creds()
    const out = await h.run('google:gmail:draft', ['--to', 'alice@example.com', '--subject', 'Test', '--body', 'Hello', '--dry-run'])
    expect(out.code, out.stderr).toBe(0)
    expect(parse(out)).toMatchObject({dryRun: true, wouldExecute: {to: 'alice@example.com', subject: 'Test'}})
    expect(mock.seen).toEqual([])
  })

  it('needs no --confirm, since nothing is sent', async () => {
    creds()
    mock.server.use(http.post(DRAFTS, () => json({id: 'r-101', message: {id: 'msg-2', threadId: 'thr-2', labelIds: ['DRAFT']}})))
    const out = await h.run('google:gmail:draft', ['--to', 'alice@example.com', '--subject', 'Test', '--body', 'Hello', '--json'])
    expect(out.code, out.stderr).toBe(0)
  })
})
