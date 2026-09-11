// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {withDnsRetry} from '../../../util/dns-retry.js'
import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'

/**
 * ServiceNow Table API query parameters.
 */
export interface TableQueryParams {
  sysparm_query?: string
  sysparm_fields?: string
  sysparm_limit?: number
  sysparm_offset?: number
  sysparm_orderby?: string
  sysparm_display_value?: 'true' | 'false' | 'all'
  sysparm_exclude_reference_link?: 'true' | 'false'
  sysparm_suppress_pagination_header?: 'true' | 'false'
}

/**
 * ServiceNow Aggregate API query parameters.
 */
export interface AggregateParams {
  sysparm_query?: string
  sysparm_group_by?: string
  sysparm_avg_fields?: string
  sysparm_sum_fields?: string
  sysparm_min_fields?: string
  sysparm_max_fields?: string
  sysparm_count?: 'true'
  sysparm_having?: string
}

/**
 * ServiceNow REST API response wrapper.
 */
export interface ServiceNowResponse<T = Record<string, unknown>> {
  result: T
  totalCount: number | null
}

/**
 * Thin REST client for ServiceNow Table API, Aggregate API, and metadata queries.
 * No external dependencies — uses Node 20+ built-in fetch.
 */
export class ServiceNowClient {
  readonly instanceUrl: string
  private authHeader: string

  constructor(instanceUrl: string, authHeader: string) {
    // Normalize: remove trailing slash
    this.instanceUrl = instanceUrl.replace(/\/+$/, '')
    this.authHeader = authHeader
  }

  // ── Table API ──────────────────────────────────────────────────────

  /**
   * Query records from a table.
   */
  async tableQuery(table: string, params?: TableQueryParams): Promise<ServiceNowResponse<Record<string, unknown>[]>> {
    const qs = params ? this.toQueryString(params) : ''
    const url = `${this.instanceUrl}/api/now/table/${table}${qs ? '?' + qs : ''}`
    return this.request<Record<string, unknown>[]>('GET', url)
  }

  /**
   * Get a single record by sys_id.
   */
  async tableGet(table: string, sysId: string, params?: Pick<TableQueryParams, 'sysparm_fields' | 'sysparm_display_value'>): Promise<ServiceNowResponse<Record<string, unknown>>> {
    const qs = params ? this.toQueryString(params) : ''
    const url = `${this.instanceUrl}/api/now/table/${table}/${sysId}${qs ? '?' + qs : ''}`
    return this.request<Record<string, unknown>>('GET', url)
  }

  /**
   * Create a record.
   */
  async tableCreate(table: string, body: Record<string, unknown>): Promise<ServiceNowResponse<Record<string, unknown>>> {
    const url = `${this.instanceUrl}/api/now/table/${table}`
    return this.request<Record<string, unknown>>('POST', url, body)
  }

  /**
   * Update a record (partial update via PATCH).
   */
  async tableUpdate(table: string, sysId: string, body: Record<string, unknown>): Promise<ServiceNowResponse<Record<string, unknown>>> {
    const url = `${this.instanceUrl}/api/now/table/${table}/${sysId}`
    return this.request<Record<string, unknown>>('PATCH', url, body)
  }

  /**
   * Delete a record.
   */
  async tableDelete(table: string, sysId: string): Promise<void> {
    const url = `${this.instanceUrl}/api/now/table/${table}/${sysId}`
    const response = await withDnsRetry(() => fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
    }))

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`ServiceNow DELETE failed (${response.status}): ${text}`)
    }
  }

  // ── Aggregate API ──────────────────────────────────────────────────

  /**
   * Get aggregate statistics for a table.
   */
  async aggregate(table: string, params: AggregateParams): Promise<ServiceNowResponse<Record<string, unknown>[]>> {
    const qs = this.toQueryString(params)
    const url = `${this.instanceUrl}/api/now/stats/${table}${qs ? '?' + qs : ''}`
    return this.request<Record<string, unknown>[]>('GET', url)
  }

  // ── Metadata ───────────────────────────────────────────────────────

  /**
   * List available tables via sys_db_object.
   */
  async listTables(query?: string): Promise<ServiceNowResponse<Record<string, unknown>[]>> {
    const baseQuery = query || 'sys_update_nameISNOTEMPTY'
    const params: TableQueryParams = {
      sysparm_query: baseQuery,
      sysparm_fields: 'name,label,super_class,sys_id',
      sysparm_limit: 500,
    }
    return this.tableQuery('sys_db_object', params)
  }

  /**
   * Walk a table's extension chain via sys_db_object.super_class.
   *
   * ServiceNow tables extend parent tables (e.g. ``incident`` extends
   * ``task``), and sys_dictionary only stores each field against the
   * table it's declared on. Describing ``incident`` alone would miss
   * core task fields like ``state``, ``priority``, ``short_description``,
   * ``assigned_to`` — all inherited from ``task``. We collect the full
   * chain here so ``describeTable`` can union the field sets.
   *
   * Returns tables ordered most-derived first (e.g. ``['incident',
   * 'task']``) so field de-duplication can keep the most-specific
   * definition when a child table overrides a parent's field.
   */
  async getTableHierarchy(table: string): Promise<string[]> {
    const chain: string[] = []
    const seen = new Set<string>()
    let current: string | null = table
    // Cap the walk at 10 levels — ServiceNow hierarchies are shallow
    // in practice and a cycle-proof ceiling protects against bad data.
    for (let depth = 0; depth < 10 && current; depth++) {
      if (seen.has(current)) break
      chain.push(current)
      seen.add(current)

      const resp = await this.tableQuery('sys_db_object', {
        sysparm_query: `name=${current}`,
        sysparm_fields: 'super_class',
        sysparm_limit: 1,
      })
      const rec = resp.result[0] as Record<string, unknown> | undefined
      if (!rec || !rec.super_class) break

      // super_class is a reference field: either a sys_id string, or
      // a {link, value} object depending on how the Table API expands
      // it. Handle both shapes.
      const superClass = rec.super_class as string | Record<string, unknown>
      const parentSysId = typeof superClass === 'string'
        ? superClass
        : ((superClass.value as string) || '')
      if (!parentSysId) break

      // Resolve the parent's table name so we can keep walking.
      const parentResp = await this.tableQuery('sys_db_object', {
        sysparm_query: `sys_id=${parentSysId}`,
        sysparm_fields: 'name',
        sysparm_limit: 1,
      })
      const parentRec = parentResp.result[0] as Record<string, unknown> | undefined
      if (!parentRec || !parentRec.name) break
      current = parentRec.name as string
    }
    return chain
  }

  /**
   * Describe a table's fields via sys_dictionary, including fields
   * inherited from parent tables in the extension chain.
   *
   * Returns sys_dictionary rows with an added ``_tableName`` marker
   * identifying which table in the chain contributed the row, so
   * callers can de-duplicate overrides deterministically.
   */
  async describeTable(table: string): Promise<ServiceNowResponse<Record<string, unknown>[]>> {
    const chain = await this.getTableHierarchy(table)
    // Fall back to the single table if the hierarchy walk failed
    // (e.g. missing sys_db_object row for a synthetic or private table).
    const tablesToQuery = chain.length > 0 ? chain : [table]

    const params: TableQueryParams = {
      // Include ``name`` in the returned fields so we can tag each row
      // with its source table for override resolution downstream.
      sysparm_query: `nameIN${tablesToQuery.join(',')}^elementISNOTEMPTY`,
      sysparm_fields:
        'name,element,column_label,internal_type,max_length,' +
        'mandatory,read_only,choice,reference,default_value,active',
      sysparm_limit: 1000,
    }
    const response = await this.tableQuery('sys_dictionary', params)

    // De-duplicate overridden fields: if ``incident`` redefines a field
    // originally declared on ``task``, keep the incident row. We walk
    // the chain in order (most-derived first) and accept the first
    // occurrence of each element name.
    const priority = new Map<string, number>()
    tablesToQuery.forEach((name, idx) => priority.set(name, idx))

    const bestByElement = new Map<string, Record<string, unknown>>()
    for (const row of response.result) {
      const element = row.element as string | undefined
      if (!element) continue
      const rowTable = row.name as string | undefined
      const rowRank = rowTable ? (priority.get(rowTable) ?? 999) : 999
      const existing = bestByElement.get(element)
      if (!existing) {
        bestByElement.set(element, row)
        continue
      }
      const existingTable = existing.name as string | undefined
      const existingRank = existingTable
        ? (priority.get(existingTable) ?? 999)
        : 999
      if (rowRank < existingRank) {
        bestByElement.set(element, row)
      }
    }

    const merged = Array.from(bestByElement.values())
    return {
      result: merged,
      totalCount: merged.length,
    }
  }

  /**
   * Get choice/picklist values for a field.
   *
   * Accepts either a single table name or a list of tables. The
   * multi-table form is needed for inherited fields: a field like
   * ``state`` is declared on ``task`` but queried as part of the
   * ``incident`` describe. Passing the table hierarchy ensures we find
   * the parent table's sys_choice rows (where ``name=task``) even when
   * the user asked about ``incident``.
   */
  async getChoices(
    table: string | string[],
    field: string,
  ): Promise<ServiceNowResponse<Record<string, unknown>[]>> {
    const tables = Array.isArray(table) ? table : [table]
    const nameClause = tables.length > 1
      ? `nameIN${tables.join(',')}`
      : `name=${tables[0]}`
    const params: TableQueryParams = {
      sysparm_query: `${nameClause}^element=${field}`,
      sysparm_fields: 'label,value,inactive',
      sysparm_limit: 200,
    }
    return this.tableQuery('sys_choice', params)
  }

  // ── Attachments ────────────────────────────────────────────────────

  /**
   * Stream the raw bytes of a ServiceNow attachment by sys_id.
   *
   * Hits ``GET /api/now/attachment/{sys_id}/file`` which returns the
   * binary with the original Content-Type set by the uploader. The
   * Table-API ``request<T>`` helper below always JSON-parses the body,
   * so binary fetches go through this dedicated path.
   */
  async streamAttachment(sysId: string): Promise<{bytes: Uint8Array; contentType: string; filename?: string}> {
    if (!sysId) throw new Error('streamAttachment requires a non-empty sys_id')
    const url = `${this.instanceUrl}/api/now/attachment/${encodeURIComponent(sysId)}/file`
    const response = await withDnsRetry(() => fetch(url, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
        Accept: '*/*',
      },
    }))

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`ServiceNow GET ${url} failed (${response.status}): ${text}`)
    }

    const buf = await response.arrayBuffer()
    const disposition = response.headers.get('content-disposition') || ''
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
    return {
      bytes: new Uint8Array(buf),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      filename: match ? decodeURIComponent(match[1]) : undefined,
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  /** Raw request for manifest commands: path relative to the instance URL. */
  async rawRequest(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<unknown> {
    const qs = query ? new URLSearchParams(query).toString() : ''
    return this.request<unknown>(method, `${this.instanceUrl}${path}${qs ? `?${qs}` : ''}`, body)
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<ServiceNowResponse<T>> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    // Retry transient DNS hiccups (EAI_AGAIN/ENOTFOUND from the host stub
    // resolver) before surfacing the error. Non-DNS failures fall through
    // to the status-code / HTML-response handling below.
    const response = await withDnsRetry(() => fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }))

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`ServiceNow ${method} ${url} failed (${response.status}): ${text}`)
    }

    // Hibernating ServiceNow developer instances return HTTP 200 with an HTML
    // wake-up page instead of JSON. Detect this at the boundary and throw a
    // marker the HealthMonitor's error classifier will recognize, rather than
    // letting JSON.parse fail with whatever ad-hoc message Node happens to
    // produce. Without this, the embedded probe sees a noisy parse error that
    // doesn't always match the classifier's substrings, and the provider can
    // be reported as healthy even when the instance is asleep.
    //
    // Some hibernation responses arrive as text/html. Others may come with
    // no content-type or even application/json while the body is actually
    // HTML. We read the body as text first and check for HTML/hibernation
    // markers before attempting JSON.parse.
    const contentType = response.headers.get('content-type') || ''
    const rawText = await response.text()
    const lowerText = rawText.toLowerCase()

    // Check for explicit hibernation markers in the response body
    if (
      lowerText.includes('instance hibernating') ||
      lowerText.includes('wait while we wake') ||
      lowerText.includes('instance_hibernating') ||
      lowerText.includes('hi.service-now.com')
    ) {
      throw new Error(`ServiceNow instance hibernating: ${url}`)
    }

    // HTML response where JSON was expected — likely hibernation/maintenance
    if (
      contentType.includes('text/html') ||
      (lowerText.trimStart().startsWith('<') && (lowerText.includes('<html') || lowerText.includes('<!doctype')))
    ) {
      throw new Error(`ServiceNow returned HTML instead of JSON (likely instance hibernating): ${url}`)
    }

    let data: {result: T}
    try {
      data = JSON.parse(rawText)
    } catch {
      throw new Error(`ServiceNow returned unparseable response (likely instance hibernating): ${url}`)
    }
    const totalCount = response.headers.get('X-Total-Count')

    return {
      result: data.result,
      totalCount: totalCount ? parseInt(totalCount, 10) : null,
    }
  }

  private toQueryString(params: TableQueryParams | AggregateParams): string {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    return entries.join('&')
  }
}

// ── Factory ───────────────────────────────────────────────────────────

/** Build a client from resolved credentials. Called through the ConnectionPool; never caches itself. */
export async function createClient(creds: ServiceAccountCredentials): Promise<ServiceNowClient> {
  let authHeader: string
  if ((creds.authType === 'session' || creds.authType === 'oauth2') && creds.accessToken) {
    authHeader = `Bearer ${creds.accessToken}`
  } else if (creds.authType === 'credentials' && creds.username && creds.password) {
    authHeader = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`
  } else {
    throw new Error('Insufficient ServiceNow credentials: provide username/password (Basic Auth) or access token (Bearer)')
  }
  return new ServiceNowClient(creds.instanceUrl, authHeader)
}
