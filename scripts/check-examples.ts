// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Parse every aciExamples[].command and every metadata commonPatterns entry
 * against the command it names (plan C-EX-1, C-EX-2): the string must start
 * with $BIN, name a registered command by its words, and its flags and
 * arguments must parse with no unknown flag and no missing required value.
 */
import {Config, Parser} from '@oclif/core'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Shell-like tokenizer: double and single quotes group, backslash escapes inside double quotes. */
export function tokenize(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let has = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i]
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else cur += ch
  }
  if (has || cur) out.push(cur)
  return out
}

export interface ExampleProblem {
  command: string
  source: 'aciExamples' | 'commonPatterns'
  example: string
  problem: string
}

export async function checkExamples(config?: Config): Promise<{checked: number; problems: ExampleProblem[]}> {
  process.env.OCLIF_TS_NODE = '0'
  const cfg = config ?? (await Config.load(ROOT))
  const own = cfg.commands.filter((c) => c.pluginName === cfg.pjson.name)
  const byWords = new Map(own.map((c) => [c.id.split(':').join(' '), c]))
  const problems: ExampleProblem[] = []
  let checked = 0

  const check = async (source: ExampleProblem['source'], owner: string, example: string) => {
    checked++
    const tokens = tokenize(example)
    if (tokens[0] !== '$BIN') {
      problems.push({command: owner, source, example, problem: `must start with $BIN (got '${tokens[0]}')`})
      return
    }
    // longest command match by words
    let match: {id: string; words: number} | undefined
    for (let n = Math.min(tokens.length - 1, 4); n >= 1; n--) {
      const key = tokens.slice(1, 1 + n).join(' ')
      const c = byWords.get(key)
      if (c) {
        match = {id: c.id, words: n}
        break
      }
    }
    if (!match) {
      problems.push({command: owner, source, example, problem: 'names no registered command'})
      return
    }
    const target = own.find((c) => c.id === match!.id)!
    const cls = (await target.load()) as unknown as {flags?: Record<string, unknown>; args?: Record<string, unknown>}
    const argv = tokens.slice(1 + match.words).filter((t) => t !== '--json')
    try {
      await Parser.parse(argv, {flags: (cls.flags ?? {}) as never, args: (cls.args ?? {}) as never, strict: true})
    } catch (err) {
      problems.push({command: owner, source, example, problem: `${match.id}: ${(err as Error).message.split('\n')[0]}`})
    }
  }

  for (const c of own) {
    const cls = (await c.load()) as unknown as {aciExamples?: Array<{command: string}>}
    for (const ex of cls.aciExamples ?? []) await check('aciExamples', c.id, ex.command)
  }
  const {getRegistry} = (await import(pathToFileURL(join(ROOT, 'lib', 'providers', 'index.js')).href)) as {getRegistry: () => {entries(): Array<{plugin: {name: string; metadata: {topics: Record<string, {commonPatterns?: string[]}>}}}>}}
  for (const {plugin} of getRegistry().entries()) {
    for (const [topic, meta] of Object.entries(plugin.metadata.topics)) {
      for (const pattern of meta.commonPatterns ?? []) {
        // Patterns read 'Label: $BIN ...'; the command starts at the token.
        const at = pattern.indexOf('$BIN')
        const cmd = at >= 0 ? pattern.slice(at) : pattern
        await check('commonPatterns', `${plugin.name}:${topic} (metadata)`, cmd)
      }
    }
  }
  return {checked, problems}
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  checkExamples().then((r) => {
    console.log(`Checked ${r.checked} example(s)`)
    for (const p of r.problems) console.log(`${p.command} [${p.source}] ${p.example}\n    ${p.problem}`)
    process.exit(r.problems.length ? 1 : 0)
  })
}
