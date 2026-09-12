// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Validators for the two published JSON Schemas, resolved from this
 * package's schemas/ directory so they work from lib/ in a downstream
 * install and from src/ under the framework's own test runner.
 */
import {Ajv2020} from 'ajv/dist/2020.js'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

export const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas')

const ajv = new Ajv2020({allErrors: true, strict: false})
const schema = (name: string) => ajv.compile(JSON.parse(readFileSync(join(SCHEMAS_DIR, `${name}.schema.json`), 'utf8')) as object)

export const validateEnvelope = schema('envelope')
export const validateAciMetadata = schema('aci-metadata')
export const validateTenantCatalog = schema('tenant-catalog')

/** K-2: assert a parsed stdout object is a valid envelope; returns it typed. */
export function assertEnvelope<T = unknown>(body: unknown): {success: boolean; result?: T; error?: {code: string; message: string}; _context?: Record<string, unknown>} {
  if (!validateEnvelope(body)) {
    throw new Error(`envelope does not match schemas/envelope.schema.json:\n${ajv.errorsText(validateEnvelope.errors, {separator: '\n'})}\n${JSON.stringify(body, null, 2)}`)
  }
  return body as ReturnType<typeof assertEnvelope<T>>
}

export function assertAciMetadata(meta: unknown, label: string): void {
  if (!validateAciMetadata(meta)) {
    throw new Error(`${label}: aciMetadata does not match schemas/aci-metadata.schema.json:\n${ajv.errorsText(validateAciMetadata.errors, {separator: '\n'})}`)
  }
}

/** Validate a tenant catalogue against its schema; returns the error text, empty when valid. */
export function tenantCatalogErrors(catalog: unknown): string {
  return validateTenantCatalog(catalog) ? '' : ajv.errorsText(validateTenantCatalog.errors, {separator: '\n'})
}
