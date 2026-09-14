import {execFileSync} from 'node:child_process'
import {mkdtemp, readFile, rm, symlink, unlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {goldenIds, listCommandIds} from '../../scripts/capture-golden.js'
import {Runtime} from '../../src/core/runtime/runtime.js'
import {builtinRegistry} from '../../src/providers/index.js'

/**
 * K-6: the packed tarball is a complete CLI root. Runtime.start({cliRoot})
 * on the unpacked package loads the same command catalog the goldens
 * describe, and the package manifest lists what the tarball must ship.
 * The pack skips lifecycle scripts (prepack would rebuild lib/ under the
 * other test files), so the oclif manifest is asserted through package.json
 * and the prepack script rather than as a file.
 */
let work: string
let root: string

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'aclif-tarball-'))
  const sh = process.platform === 'win32'
  const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', work, '--silent'], {encoding: 'utf8', shell: sh}).trim().split('\n').pop()!
  execFileSync('tar', ['-xzf', join(work, packed), '-C', work], {encoding: 'utf8'})
  root = join(work, 'package')
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'junction')
}, 300_000)
afterAll(async () => {
  if (root) await unlink(join(root, 'node_modules')).catch(() => undefined)
  if (work) await rm(work, {recursive: true, force: true, maxRetries: 5})
}, 300_000)

describe('K-6 packed tarball', () => {
  it('lists the files the tarball must ship and generates the oclif manifest on pack', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {files: string[]; scripts: Record<string, string>; oclif: {commands: {target: string}}}
    for (const f of ['/bin', '/lib', '/schemas', '/oclif.manifest.json']) expect(pkg.files).toContain(f)
    expect(pkg.scripts.prepack).toContain('oclif manifest')
    expect(pkg.oclif.commands.target).toBe('./lib/commands-index.js')
    for (const f of ['lib/commands-index.js', 'lib/cli/hooks/init.js', 'schemas/envelope.schema.json', 'schemas/aci-metadata.schema.json', 'bin/run.js']) {
      await expect(readFile(join(root, f)), f).resolves.toBeDefined()
    }
  })

  it('Runtime.start({cliRoot}) on the unpacked package loads the golden command set', async () => {
    process.env.OCLIF_TS_NODE = '0'
    const runtime = await Runtime.start({cliRoot: root, registry: builtinRegistry()})
    try {
      const ids = listCommandIds(runtime.config)
      const golden = (await goldenIds()).sort()
      expect(ids).toEqual(golden)
      expect(runtime.config.root).toBe(root)
    } finally {
      runtime.stop()
    }
  }, 120_000)
})
