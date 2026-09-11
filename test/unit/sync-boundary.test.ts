import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

/** U-SYNC-1: check-sync-boundary against a temporary git history. */
const SCRIPT = resolve('scripts/check-sync-boundary.mjs')
let repo: string
const gitEnv = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com'}
const git = (...args: string[]) => execFileSync('git', args, {cwd: repo, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
function commitFiles(files: Record<string, string>, message: string): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), {recursive: true})
    writeFileSync(join(repo, rel), content)
  }
  git('add', '-A')
  git('commit', '-q', '-m', message)
}
function check(): {status: number; output: string} {
  try {
    return {status: 0, output: execFileSync(process.execPath, [SCRIPT, 'main'], {cwd: repo, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})}
  } catch (e) {
    const err = e as {stdout?: string; stderr?: string; status?: number}
    return {status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}`}
  }
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'aclif-sync-'))
  git('init', '-q', '-b', 'main')
  commitFiles({'src/core/a.ts': 'a', 'src/providers/private/README.md': 'private', '.github/CODEOWNERS': '/src/providers/native/ @x\n'}, 'base')
})
afterAll(() => rmSync(repo, {recursive: true, force: true}))

describe('U-SYNC-1 check-sync-boundary', () => {
  it('passes a diff that touches only core', () => {
    git('checkout', '-q', '-b', 'core-only', 'main')
    commitFiles({'src/core/b.ts': 'b'}, 'core')
    const r = check()
    expect(r.status, r.output).toBe(0)
    expect(r.output).toContain('none inside the private tier')
  })

  it.each(['src/providers/private/acme/plugin.ts', 'test/providers/private/acme.test.ts', 'test/fixtures/private/acme.json', 'docs/providers/private/acme/SETUP.md'])('fails naming %s', (path) => {
    git('checkout', '-q', '-b', `bad-${path.replace(/[^a-z]/gi, '-')}`, 'main')
    commitFiles({[path]: 'x'}, 'private change')
    const r = check()
    expect(r.status).toBe(1)
    expect(r.output).toContain(path)
  })

  it('passes when only the private READMEs change, and fails a CODEOWNERS line for a private path', () => {
    git('checkout', '-q', '-b', 'readmes', 'main')
    commitFiles({'src/providers/private/README.md': 'updated', 'docs/providers/private/README.md': 'new'}, 'readmes')
    expect(check().status).toBe(0)
    git('checkout', '-q', '-b', 'owners', 'main')
    commitFiles({'.github/CODEOWNERS': '/src/providers/native/ @x\n/src/providers/private/acme/ @me\n'}, 'owners')
    const r = check()
    expect(r.status).toBe(1)
    expect(r.output).toContain('CODEOWNERS (adds an owner for a private path)')
  })

  it('exits 2 when the base ref does not exist', () => {
    let status = 0
    try {
      execFileSync(process.execPath, [SCRIPT, 'no-such-ref'], {cwd: repo, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
    } catch (e) {
      status = (e as {status: number}).status
    }
    expect(status).toBe(2)
  })
})
