import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {goldenPath, normalize, readGolden, runBinary} from '../../scripts/capture-golden.js'

/**
 * The golden files are captured in-process. This test spawns the real
 * binary for a sample of commands and flags and asserts the bytes match,
 * so the in-process capture is proven equivalent to what an agent sees
 * on the command line. Also the standalone form of E-3: introspection
 * under an empty environment exits 0 with JSON on stdout.
 */
const SAMPLE: Array<[string, string, string[]]> = [
  ['discover', 'schema', ['--schema']],
  ['salesforce:data:query', 'schema', ['--schema']],
  ['salesforce:data:query', 'examples', ['--examples']],
  ['servicenow:data:query', 'shape', ['--shape']],
  ['docusign:envelopes:list', 'flags-for-auth', ['--flags-for', 'auth']],
  ['agentforce:sessions:start', 'estimate', ['--estimate']],
]

describe('binary introspection matches golden', () => {
  let home: string
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'aclif-binary-'))
  })
  afterAll(async () => {
    await rm(home, {recursive: true, force: true})
  })

  it.each(SAMPLE)('%s %s', async (id, flag, argv) => {
    const out = await runBinary([...id.split(':'), ...argv], home)
    expect(out.code, out.stderr).toBe(0)
    const golden = await readGolden(goldenPath(id, flag))
    expect(normalize(out.stdout)).toBe(golden)
  }, 60_000)
})
