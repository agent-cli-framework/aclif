import {describe, expect, it} from 'vitest'

import {checkExamples, tokenize} from '../../scripts/check-examples.js'

describe('C-EX-1 and C-EX-2 examples', () => {
  it('tokenizes like a shell', () => {
    expect(tokenize(`$BIN salesforce data query --query "SELECT Id FROM Account WHERE Name = 'Acme'" --json`)).toEqual([
      '$BIN', 'salesforce', 'data', 'query', '--query', "SELECT Id FROM Account WHERE Name = 'Acme'", '--json',
    ])
    expect(tokenize(`$BIN x --values '{"Name":"Test"}' --flag ""`)).toEqual(['$BIN', 'x', '--values', '{"Name":"Test"}', '--flag', ''])
  })

  it('every aciExamples command and metadata pattern starts with $BIN, names a command, and parses against its flags', async () => {
    const r = await checkExamples()
    expect(r.checked).toBeGreaterThan(100)
    expect(r.problems.map((p) => `${p.command} [${p.source}] ${p.example} -> ${p.problem}`)).toEqual([])
  }, 120_000)
})
