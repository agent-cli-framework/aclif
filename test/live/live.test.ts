import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {credentialsFromSchema, valuesFromEnv} from '../../src/core/provider/credential-schema.js'
import {builtinRegistry} from '../../src/providers/index.js'
import {tokenize} from '../../scripts/check-examples.js'
import {runBinary} from '../../scripts/capture-golden.js'
import {assertEnvelope} from '../helpers/envelope.js'

/**
 * L: live smoke, opt-in with ACI_LIVE_TESTS=1 and real credentials in the
 * environment. Never runs in CI. For every provider whose credentials
 * resolve: one idempotent read (the plugin's health probe, else its first
 * read example) and one mutation with --dry-run, through the built binary.
 * A maintainer runs this before tagging a release.
 */
const LIVE = process.env.ACI_LIVE_TESTS === '1'
const registry = builtinRegistry()
const env = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => /^[A-Z][A-Z0-9_]*$/.test(k))) as NodeJS.ProcessEnv

let home: string
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'aclif-live-'))
})
afterAll(async () => {
  if (home) await rm(home, {recursive: true, force: true})
})

const argvOf = (command: string) => tokenize(command).slice(1)

describe.skipIf(!LIVE)('L live smoke', () => {
  for (const {plugin, tier} of registry.entries()) {
    const resolved = credentialsFromSchema(plugin.credentials, valuesFromEnv(plugin.credentials, process.env))
    const label = `${plugin.name} (${tier})`
    if (!resolved) {
      it.skip(`${label}: no credentials in the environment`, () => undefined)
      continue
    }
    const reads = Object.entries(plugin.commands).filter(([, c]) => c.aciMetadata.mutability === 'read')
    const readArgv = plugin.healthProbe ?? argvOf((reads.map(([, c]) => (c as unknown as {aciExamples?: Array<{command: string}>}).aciExamples?.[0]?.command).find(Boolean) ?? ''))

    it(`${label}: idempotent read (${readArgv.join(' ')})`, async () => {
      const out = await runBinary([...readArgv, '--json'], home, env())
      expect(out.code, out.stdout + out.stderr).toBe(0)
      expect(assertEnvelope(JSON.parse(out.stdout)).success).toBe(true)
    }, 120_000)

    const mutation = Object.values(plugin.commands).map((c) => (c as unknown as {aciExamples?: Array<{command: string}>; aciMetadata: {mutability: string}})).find((c) => c.aciMetadata.mutability !== 'read' && c.aciExamples?.[0])
    if (mutation) {
      const argv = argvOf(mutation.aciExamples![0].command).filter((t) => t !== '--confirm')
      it(`${label}: mutation preview (${argv.join(' ')} --dry-run)`, async () => {
        const out = await runBinary([...argv, '--dry-run'], home, env())
        expect(out.code, out.stdout + out.stderr).toBe(0)
        expect(JSON.parse(out.stdout)).toMatchObject({dryRun: true})
      }, 120_000)
    }
  }
})
