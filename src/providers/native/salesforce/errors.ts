// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import type {AciError} from '../../../core/contract/aci.js'

/**
 * Detect the Salesforce "ORDER BY <aggregate-alias>" trap and return a
 * targeted hint + suggested rewrite.
 *
 * Salesforce rejects ORDER BY on the alias of an aggregate expression:
 * given ``SELECT X, COUNT(Id) Cases ... ORDER BY Cases DESC``, the error
 * surfaces as ``INVALID_FIELD: No such column 'Cases' on entity 'Case'``.
 * The alias isn't a column — it's a response field name, and SOQL won't
 * resolve it in ORDER BY. Callers must reference the aggregate itself,
 * e.g. ``ORDER BY COUNT(Id) DESC``.
 *
 * This detector returns a refined hint only when (a) the query has an
 * aggregate function, (b) the missing-column name appears in the ORDER
 * BY clause, and (c) an aggregate alias with that exact name is declared
 * in the SELECT list. When a match is found we synthesise a corrected
 * query so the caller can replay immediately. Returns ``undefined`` when
 * the pattern doesn't match so the generic INVALID_FIELD hint keeps
 * applying.
 */
export function refineAggregateOrderByError(
  errorMessage: string,
  query: string | undefined,
): {syntaxGuide: string; workingExample: string; correctedValue?: string} | undefined {
  if (!query) return undefined

  // Pull the column name Salesforce says doesn't exist. jsforce formats
  // it like ``No such column 'Cases' on entity 'Case'`` — grab the
  // first quoted token.
  const missingMatch = errorMessage.match(/No such column '([^']+)'/i)
  if (!missingMatch) return undefined
  const missingCol = missingMatch[1]

  // Aggregate function present anywhere in the query.
  const aggregateMatch = query.match(/\b(COUNT|SUM|AVG|MAX|MIN)\s*\(([^)]*)\)/i)
  if (!aggregateMatch) return undefined
  const aggregateExpr = aggregateMatch[0]

  // Look for an ORDER BY clause that references the missing column.
  const orderByMatch = query.match(/\bORDER\s+BY\s+([^]*?)(?:\bLIMIT\b|\bOFFSET\b|$)/i)
  if (!orderByMatch) return undefined
  const orderByClause = orderByMatch[1]
  const missingInOrderBy = new RegExp(`\\b${missingCol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  if (!missingInOrderBy.test(orderByClause)) return undefined

  // Confirm the missing token is declared as an alias on the aggregate
  // in the SELECT list — i.e. ``COUNT(Id) Cases`` or ``COUNT(Id) AS
  // Cases``. Without this check a genuinely missing column in ORDER BY
  // would be mis-classified as the alias trap.
  const selectMatch = query.match(/\bSELECT\b([^]*?)\bFROM\b/i)
  if (!selectMatch) return undefined
  const aliasRegex = new RegExp(
    `\\b(COUNT|SUM|AVG|MAX|MIN)\\s*\\([^)]*\\)\\s+(?:AS\\s+)?${missingCol.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    )}\\b`,
    'i',
  )
  if (!aliasRegex.test(selectMatch[1])) return undefined

  // Replace inside the ORDER BY clause only; the alias also appears in
  // the SELECT list, where it must stay.
  const orderByStart = orderByMatch.index! + orderByMatch[0].indexOf(orderByClause)
  const corrected =
    query.slice(0, orderByStart) +
    orderByClause.replace(missingInOrderBy, aggregateExpr) +
    query.slice(orderByStart + orderByClause.length)

  return {
    syntaxGuide:
      `Salesforce SOQL does not allow ORDER BY on aggregate aliases. ` +
      `Reference the aggregate expression directly (e.g. ORDER BY ${aggregateExpr} DESC), ` +
      `not the alias (ORDER BY ${missingCol} DESC).`,
    workingExample:
      `SELECT AccountId, COUNT(Id) Cases FROM Case GROUP BY AccountId ` +
      `ORDER BY COUNT(Id) DESC LIMIT 10`,
    correctedValue: corrected,
  }
}



/**
 * Salesforce error hints: field and object lookups, SOQL syntax, and the
 * aggregate-alias ORDER BY trap (refined from the failing query when the
 * caller passes it). Returns undefined when no hint applies.
 */
export function classifySalesforceError(error: unknown, context?: {query?: string}): AciError | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message.toLowerCase()
  if (msg.includes('invalid_field') || msg.includes('no such column')) {
    const hint: AciError = {
      code: 'INVALID_FIELD',
      message: error.message,
      syntaxGuide: 'Use --schema to see available fields for this object',
      workingExample: '$BIN salesforce data query --query "SELECT Id, Name FROM <Object> LIMIT 5" --json',
    }
    const refined = refineAggregateOrderByError(error.message, context?.query)
    if (refined) {
      hint.code = 'SOQL_AGGREGATE_ALIAS_ORDER_BY'
      hint.syntaxGuide = refined.syntaxGuide
      hint.workingExample = refined.workingExample
      if (refined.correctedValue) hint.correctedValue = refined.correctedValue
    }
    return hint
  }
  if (msg.includes('malformed_query') || msg.includes('soql')) {
    return {code: 'MALFORMED_QUERY', message: error.message, syntaxGuide: 'SOQL syntax: SELECT <fields> FROM <object> [WHERE <condition>] [ORDER BY <field>] [LIMIT <n>]'}
  }
  if (msg.includes('invalid_type') || msg.includes('sobject type')) {
    return {code: 'INVALID_OBJECT', message: error.message, syntaxGuide: 'Use "$BIN salesforce discover" to list available objects'}
  }
  const errorCode = String((error as {errorCode?: unknown}).errorCode ?? '').toLowerCase()
  if (errorCode === 'invalid_session_id' || msg.includes('invalid_session_id') || msg.includes('session expired') || msg.includes('(401)') || msg.includes('invalid_login') || msg.includes('returned a login page')) {
    return {code: 'AUTHENTICATION_FAILED', message: error.message, syntaxGuide: 'The session or login was rejected. Supply a fresh --access-token, or log in again with username and password; `$BIN auth logout salesforce` clears a cached session.'}
  }
  if (errorCode === 'request_limit_exceeded' || msg.includes('request_limit_exceeded') || msg.includes('(429)')) {
    return {code: 'RATE_LIMITED', message: error.message, syntaxGuide: 'The org has used its API request allocation. Wait for the rolling 24-hour window to free requests, or narrow the query.'}
  }
  return undefined
}
