// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Sample-derived schema inference.
 *
 * Some providers expose no schema endpoint at all (LinkedIn Ads) or
 * gate it behind a permission the platform's API role does not hold
 * (Mautic's /api/fields/* is 403 for a plain API-user role). For those
 * the only honest source of field metadata is a real record: read one
 * row and report the keys it actually carries.
 *
 * The trade-off is explicit and callers surface it: fields that are
 * null on the sampled row cannot have their type inferred (reported as
 * ``unknown``), and fields absent from the sample are invisible. That
 * is still strictly better than a hand-authored list, which goes stale
 * silently and can invent fields that never existed.
 */

/** Loose ISO-8601 / Mautic / LinkedIn date shapes. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}|$)/

/**
 * Best-effort JSON-value → field-type mapping.
 *
 * Returns the same vocabulary the Salesforce/ServiceNow describes use
 * where they overlap (string, boolean, datetime, ...) so downstream
 * consumers don't need a per-provider type table.
 */
export function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'unknown'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') {
    if (DATE_RE.test(value)) return 'datetime'
    // Epoch-millis timestamps are pervasive in LinkedIn's API and
    // arrive as numeric strings; treating them as plain strings would
    // mislead a caller into string-comparing them.
    if (/^\d{13}$/.test(value)) return 'datetime'
    return 'string'
  }
  return 'unknown'
}

/**
 * Turn an API field name into a display label:
 * ``dateModified`` → "Date Modified", ``cost_in_usd`` → "Cost In Usd".
 *
 * Only used when the provider ships no label of its own.
 */
export function humanizeLabel(name: string): string {
  const spaced = name
    .replace(/[_.-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
  if (!spaced) return name
  return spaced
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** One inferred field, in the shape the provider describe commands emit. */
export interface InferredField {
  name: string
  label: string
  type: string
  required: boolean
  custom?: boolean
  /** True when the sampled value was null/absent, so ``type`` is a guess. */
  inferred: true
}

/**
 * Derive a field list from one sample record.
 *
 * Nested objects are reported as a single ``object`` field rather than
 * flattened — flattening would imply a stability the API never
 * promised, and the caller can always sample the row itself.
 */
export function inferFieldsFromRecord(
  record: Record<string, unknown>,
  opts: {labels?: Record<string, string>} = {},
): InferredField[] {
  return Object.keys(record)
    .sort()
    .map((name) => ({
      name,
      label: opts.labels?.[name] ?? humanizeLabel(name),
      type: inferType(record[name]),
      // Nothing in a sample row can establish a NOT NULL constraint,
      // so every sample-derived field is reported nullable. Saying
      // otherwise would be a fabricated constraint.
      required: false,
      inferred: true as const,
    }))
}
