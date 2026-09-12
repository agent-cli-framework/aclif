// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.

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
