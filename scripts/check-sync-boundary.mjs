// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
// Fail when a diff against the upstream base touches the fork-owned private
// tier. Run locally before opening a PR (`npm run check-sync-boundary`),
// and by upstream CI on every pull request (K-7).
//
//   node scripts/check-sync-boundary.mjs [base-ref]   default: upstream/main
import {execSync} from 'node:child_process'

const PREFIXES = ['src/providers/private/', 'test/providers/private/', 'test/fixtures/private/', 'docs/providers/private/']
const ALLOWED = new Set(PREFIXES.map((p) => `${p}README.md`))
const base = process.argv[2] ?? 'upstream/main'

let changed
try {
  changed = execSync(`git diff --name-only ${base}...HEAD`, {encoding: 'utf8'}).split('\n').filter(Boolean)
} catch (err) {
  console.error(`check-sync-boundary: cannot diff against ${base}: ${err.message.split('\n')[0]}`)
  process.exit(2)
}
const violations = changed.filter((f) => PREFIXES.some((p) => f.startsWith(p)) && !ALLOWED.has(f))

if (changed.includes('.github/CODEOWNERS')) {
  const lines = execSync(`git diff ${base}...HEAD -- .github/CODEOWNERS`, {encoding: 'utf8'}).split('\n')
  if (lines.some((l) => l.startsWith('+') && !l.startsWith('+++') && l.includes('/private/'))) violations.push('.github/CODEOWNERS (adds an owner for a private path)')
}

if (violations.length) {
  console.error('check-sync-boundary: this branch changes fork-owned paths that never go upstream:')
  for (const v of violations) console.error(`  ${v}`)
  console.error('Cut the contribution branch from upstream/main, or move the change out of the private tier.')
  process.exit(1)
}
console.log(`check-sync-boundary: ${changed.length} changed file(s) against ${base}, none inside the private tier`)
