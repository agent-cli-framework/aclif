import {describe, expect, it} from 'vitest'

import {capture} from '../../scripts/capture-golden.js'

/**
 * K-1: golden introspection output for every command and flag matches the
 * committed files. Regenerate deliberately with `npm run golden:capture`
 * and review the diff in the PR; intended contract changes update the
 * goldens and add a CHANGELOG line in the same PR.
 */
describe('K-1 golden introspection output', () => {
  it('matches test/contract/golden for every command and introspection flag', async () => {
    const r = await capture({check: true})
    expect(r.cases).toBeGreaterThan(0)
    expect(r.failed, 'introspection calls that did not exit 0 with JSON on stdout').toEqual([])
    expect(r.missing, 'cases with no golden file; run npm run golden:capture').toEqual([])
    expect(r.stale, 'golden directories for commands that no longer exist').toEqual([])
    expect(r.changed, 'golden drift; review the diff, then npm run golden:capture').toEqual([])
  }, 300_000)
})
