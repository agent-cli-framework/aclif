import {describe, expect, it} from 'vitest'

import {humanizeLabel, inferFieldsFromRecord, inferType} from '../../src/core/discovery/schema-inference.js'

/** U-INF-1 and U-INF-2. */
describe('U-INF-1 inferType', () => {
  it.each([
    [null, 'unknown'], [undefined, 'unknown'], [true, 'boolean'], [3, 'int'], [3.5, 'double'], [[1], 'array'], [{a: 1}, 'object'],
    ['2026-09-10T12:00:00Z', 'datetime'], ['2026-09-10', 'datetime'], ['1757505600000', 'datetime'], ['hello', 'string'], ['123', 'string'],
  ])('%j → %s', (value, expected) => {
    expect(inferType(value)).toBe(expected)
  })
})

describe('U-INF-2 humanizeLabel and inferFieldsFromRecord', () => {
  it('humanises camelCase, snake_case, dotted, and mixed names', () => {
    expect(humanizeLabel('firstName')).toBe('First Name')
    expect(humanizeLabel('created_at')).toBe('Created At')
    expect(humanizeLabel('owner.name')).toBe('Owner Name')
    expect(humanizeLabel('sys_updated-on')).toBe('Sys Updated On')
    expect(humanizeLabel('id')).toBe('Id')
    expect(humanizeLabel('___')).toBe('___')
  })

  it('infers sorted, nullable fields with label overrides', () => {
    const fields = inferFieldsFromRecord({zeta: 1, alpha: 'x', createdAt: '2026-01-01T00:00:00Z'}, {labels: {alpha: 'The Alpha'}})
    expect(fields.map((f) => f.name)).toEqual(['alpha', 'createdAt', 'zeta'])
    expect(fields[0]).toEqual({name: 'alpha', label: 'The Alpha', type: 'string', required: false, inferred: true})
    expect(fields[1]).toMatchObject({label: 'Created At', type: 'datetime'})
    for (const f of fields) {
      expect(f.required).toBe(false)
      expect(f.inferred).toBe(true)
    }
    expect(inferFieldsFromRecord({})).toEqual([])
  })
})
