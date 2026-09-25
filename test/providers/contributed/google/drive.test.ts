import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {tokenize} from '../../../../scripts/check-examples.js'
import {assertEnvelope} from '../../../helpers/envelope.js'
import {http, json, startServer} from '../../../helpers/msw.js'
import {parse, providerHarness, type ProviderHarness} from '../../../helpers/provider-suite.js'

/**
 * `google drive list` and `google drive get` over msw. The Drive handler
 * serves a small folder tree keyed by the parent id in `q`, paging by
 * `pageSize` so the walk's resume token is exercised.
 */
const FILES = /\/drive\/v3\/files$/
const FOLDER = 'application/vnd.google-apps.folder'

type Item = {id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; md5Checksum?: string; parents?: string[]; webViewLink?: string}
const file = (id: string, name: string, parent: string): Item => ({id, name, mimeType: 'application/pdf', modifiedTime: '2026-09-01T12:00:00.000Z', size: '1024', md5Checksum: `md5-${id}`, parents: [parent], webViewLink: `https://drive.google.com/file/d/${id}/view`})
const folder = (id: string, name: string, parent: string): Item => ({id, name, mimeType: FOLDER, parents: [parent]})

// root/ a.pdf, productions/ (b.pdf, 2026-09/ (c.pdf, d.pdf)), notes (Google Doc)
const TREE: Record<string, Item[]> = {
  root: [folder('f-prod', 'productions', 'root'), file('a', 'a.pdf', 'root'), {id: 'doc', name: 'notes', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-09-02T00:00:00.000Z', parents: ['root'], webViewLink: 'https://docs.google.com/document/d/doc/edit'}],
  'f-prod': [folder('f-sep', '2026-09', 'f-prod'), file('b', 'b.pdf', 'f-prod')],
  'f-sep': [file('c', 'c.pdf', 'f-sep'), file('d', 'd.pdf', 'f-sep')],
}

const driveTree = () => http.get(FILES, ({request}) => {
  const url = new URL(request.url)
  const parent = /^'([^']+)' in parents/.exec(url.searchParams.get('q') ?? '')![1]
  const items = TREE[parent] ?? []
  const start = Number(url.searchParams.get('pageToken') ?? 0)
  const size = Number(url.searchParams.get('pageSize'))
  const end = start + size
  return json({files: items.slice(start, end), ...(end < items.length ? {nextPageToken: String(end)} : {})})
})

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

describe('P-google drive list', () => {
  it('lists the files directly in the folder, skipping folders and trashed files', async () => {
    creds()
    mock.server.use(driveTree())
    const out = await h.run('google:drive:list', ['--folder-id', 'root', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{files: Array<Record<string, unknown>>}>(parse(out))
    expect(env.result!.files.map((f) => f.id)).toEqual(['a', 'doc'])
    expect(env.result!.files[0]).toEqual({id: 'a', name: 'a.pdf', mimeType: 'application/pdf', modifiedTime: '2026-09-01T12:00:00.000Z', size: 1024, md5Checksum: 'md5-a', parents: ['root'], webViewLink: 'https://drive.google.com/file/d/a/view', folderPath: ''})
    expect(env.result!.files[1]).not.toHaveProperty('size')
    expect(env._context).toMatchObject({pagination: {returned: 2, hasMore: false, nextCommand: null}})
    const req = new URL(mock.seen[0].url)
    expect(req.searchParams.get('q')).toBe("'root' in parents and trashed = false")
    expect(req.searchParams.get('fields')).toContain('files(id,name,mimeType,modifiedTime,size,md5Checksum,parents,webViewLink')
    expect(mock.seen[0].headers.authorization).toBe('Bearer gw-access')
    expect(mock.seen).toHaveLength(1)
  })

  it('--recursive walks subfolders and gives each file its subfolder path', async () => {
    creds()
    mock.server.use(driveTree())
    const out = await h.run('google:drive:list', ['--folder-id', 'root', '--recursive', '--limit', '1000', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{files: Array<{id: string; folderPath: string}>}>(parse(out))
    expect(env.result!.files.map((f) => [f.id, f.folderPath])).toEqual([
      ['a', ''], ['doc', ''], ['b', 'productions'], ['c', 'productions/2026-09'], ['d', 'productions/2026-09'],
    ])
    expect(env._context).toMatchObject({pagination: {hasMore: false, nextCommand: null}})
  })

  it('pages with a resume token that continues the walk without gaps or repeats', async () => {
    creds()
    mock.server.use(driveTree())
    const ids: string[] = []
    let argv = ['--folder-id', 'root', '--recursive', '--limit', '2', '--json']
    for (let i = 0; i < 10; i++) {
      const env = assertEnvelope<{files: Array<{id: string}>}>(parse(await h.run('google:drive:list', argv)))
      expect(env.result!.files.length).toBeLessThanOrEqual(2)
      ids.push(...env.result!.files.map((f) => f.id))
      const {nextCommand} = env._context!.pagination as {nextCommand: string | null}
      if (!nextCommand) break
      const tokens = tokenize(nextCommand)
      expect(tokens.slice(0, 4)).toEqual(['aclif', 'google', 'drive', 'list'])
      expect(tokens).toContain('--recursive')
      argv = [...tokens.slice(4), '--json']
      await h.fresh()
    }
    expect(ids).toEqual(['a', 'doc', 'b', 'c', 'd'])
  })

  it('rejects a page token it did not issue', async () => {
    creds()
    const out = await h.run('google:drive:list', ['--folder-id', 'root', '--page-token', 'not-a-token', '--json'])
    expect(out.code).not.toBe(0)
    expect(mock.seen).toEqual([])
  })

  it('maps a 403 from Drive to INSUFFICIENT_ACCESS', async () => {
    creds()
    mock.server.use(http.get(FILES, () => json({error: {code: 403, message: 'Request had insufficient authentication scopes.'}}, {status: 403})))
    const out = await h.run('google:drive:list', ['--folder-id', 'root', '--json'])
    expect(out.code).not.toBe(0)
    expect(assertEnvelope(parse(out)).error).toMatchObject({code: 'INSUFFICIENT_ACCESS'})
  })
})

describe('P-google drive get', () => {
  it('returns one file\'s metadata with trashed', async () => {
    creds()
    mock.server.use(http.get(/\/drive\/v3\/files\/c$/, () => json({...file('c', 'c.pdf', 'f-sep'), trashed: false})))
    const out = await h.run('google:drive:get', ['--file-id', 'c', '--json'])
    expect(out.code, out.stderr).toBe(0)
    expect(assertEnvelope(parse(out)).result).toEqual({id: 'c', name: 'c.pdf', mimeType: 'application/pdf', modifiedTime: '2026-09-01T12:00:00.000Z', size: 1024, md5Checksum: 'md5-c', parents: ['f-sep'], webViewLink: 'https://drive.google.com/file/d/c/view', trashed: false})
    expect(new URL(mock.seen[0].url).searchParams.get('supportsAllDrives')).toBe('true')
  })

  it('maps a 404 to RESOURCE_NOT_FOUND', async () => {
    creds()
    mock.server.use(http.get(/\/drive\/v3\/files\/missing$/, () => json({error: {code: 404, message: 'File not found: missing.'}}, {status: 404})))
    const out = await h.run('google:drive:get', ['--file-id', 'missing', '--json'])
    expect(assertEnvelope(parse(out)).error).toMatchObject({code: 'RESOURCE_NOT_FOUND'})
  })
})
