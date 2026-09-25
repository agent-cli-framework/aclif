import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {assertEnvelope} from '../../../helpers/envelope.js'
import {http, json, settle, startServer} from '../../../helpers/msw.js'
import {parse, providerHarness, type ProviderHarness} from '../../../helpers/provider-suite.js'

/**
 * `google calendar update` over msw: --all-day sends dates and clears
 * dateTime; a timed update clears date, so an event can move between the
 * two forms.
 */
const EVENT = /\/calendar\/v3\/calendars\/primary\/events\/evt123$/

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
const patched = () => JSON.parse(mock.seen.find((r) => r.method === 'PATCH' && EVENT.test(r.path))!.body) as Record<string, unknown>

describe('P-google calendar update', () => {
  it('--all-day patches start and end as dates and clears dateTime', async () => {
    creds()
    mock.server.use(http.patch(EVENT, () => json({id: 'evt123', summary: 'Reply brief due', start: {date: '2026-10-02'}, end: {date: '2026-10-03'}, status: 'confirmed'})))
    const out = await h.run('google:calendar:update', ['--event-id', 'evt123', '--start', '2026-10-02', '--end', '2026-10-03', '--all-day', '--json'])
    expect(out.code, out.stderr).toBe(0)
    await settle()
    expect(patched()).toEqual({start: {date: '2026-10-02', dateTime: null}, end: {date: '2026-10-03', dateTime: null}})
    expect(assertEnvelope(parse(out)).result).toMatchObject({id: 'evt123', start: '2026-10-02', end: '2026-10-03'})
  })

  it('a timed update clears date, so an all-day event can become timed', async () => {
    creds()
    mock.server.use(http.patch(EVENT, () => json({id: 'evt123', start: {dateTime: '2026-10-02T15:00:00Z'}, end: {dateTime: '2026-10-02T15:30:00Z'}, status: 'confirmed'})))
    const out = await h.run('google:calendar:update', ['--event-id', 'evt123', '--start', '2026-10-02T15:00:00Z', '--end', '2026-10-02T15:30:00Z', '--json'])
    expect(out.code, out.stderr).toBe(0)
    await settle()
    expect(patched()).toEqual({start: {dateTime: '2026-10-02T15:00:00Z', date: null}, end: {dateTime: '2026-10-02T15:30:00Z', date: null}})
  })

  it('--all-day without both dates exits 2 before any request', async () => {
    creds()
    const out = await h.run('google:calendar:update', ['--event-id', 'evt123', '--start', '2026-10-02', '--all-day', '--json'])
    expect(out.code).toBe(2)
    expect(mock.seen).toEqual([])
  })

  it('--all-day with a timestamp exits 2 before any request', async () => {
    creds()
    const out = await h.run('google:calendar:update', ['--event-id', 'evt123', '--start', '2026-10-02T15:00:00Z', '--end', '2026-10-03', '--all-day', '--json'])
    expect(out.code).toBe(2)
    expect(mock.seen).toEqual([])
  })
})
