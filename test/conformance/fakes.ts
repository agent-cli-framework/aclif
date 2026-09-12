/**
 * Recording fakes for the framework's own providers, supplied to the
 * conformance suite through its options. A downstream CLI supplies fakes
 * for its own providers the same way.
 */
import type {RecordingFake} from '../../src/testing/index.js'

/** Wrap an implementation so every member access is recorded and anything undeclared throws. */
export function recording<T extends object>(impl: T): {client: T; calls: string[]} {
  const calls: string[] = []
  const client = new Proxy(impl, {
    get(t, p) {
      if (p === 'then') return undefined
      if (!(p in t)) throw new Error(`fake client has no member '${String(p)}'`)
      calls.push(String(p))
      const v = Reflect.get(t, p)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
  return {client, calls}
}

const sfField = (name: string, custom = false) => ({name, label: name, type: 'string', length: 0, nillable: true, createable: true, updateable: true, defaultValue: null, picklistValues: [], referenceTo: [], relationshipName: null, externalId: false, unique: false, calculated: false, custom})

export function salesforceFake() {
  const described: string[] = []
  const impl = {
    version: '59.0',
    userInfo: undefined,
    async describeGlobal() {
      return {sobjects: [
        {name: 'Account', custom: false, queryable: true},
        {name: 'Contact', custom: false, queryable: true},
        {name: 'Task', custom: false, queryable: true},
        {name: 'Warranty__c', custom: true, queryable: true},
        {name: 'Hidden__c', custom: true, queryable: false},
      ]}
    },
    async describe(name: string) {
      described.push(name)
      return {name, label: name, labelPlural: name, keyPrefix: '001', queryable: true, createable: true, updateable: true, deletable: true, fields: [sfField('Id'), sfField('Tier__c', true)], childRelationships: []}
    },
  }
  return {...recording(impl), described}
}

export function servicenowFake() {
  const queries: string[] = []
  const described: string[] = []
  const impl = {
    instanceUrl: 'https://example.invalid',
    async listTables(query?: string) {
      queries.push(query ?? '')
      return {result: [{name: 'incident'}, {name: 'u_custom'}]}
    },
    async getTableHierarchy(t: string) {
      return [t]
    },
    async describeTable(t: string) {
      described.push(t)
      return {result: [{element: 'number', column_label: 'Number', internal_type: 'string', max_length: '40', mandatory: 'false', read_only: 'false', choice: '0'}]}
    },
    async getChoices() {
      return {result: []}
    },
  }
  return {...recording(impl), queries, described}
}

export const TENANT_FAKES: Record<string, () => RecordingFake> = {salesforce: salesforceFake, servicenow: servicenowFake}

export const READ_ONLY_MEMBERS: Record<string, string[]> = {
  salesforce: ['describeGlobal', 'describe', 'userInfo', 'version'],
  servicenow: ['listTables', 'getTableHierarchy', 'describeTable', 'getChoices', 'instanceUrl'],
}

export function httpFake(name: string): {client: Record<string, unknown>; requests: unknown[][]} {
  const requests: unknown[][] = []
  const record = async (...args: unknown[]) => {
    requests.push(args)
    return {ok: true, args}
  }
  const client: Record<string, unknown> = name === 'salesforce'
    ? {accessToken: 'tok', instanceUrl: 'https://example.invalid', request: record}
    : {rawRequest: record, exportSession: () => undefined}
  return {client, requests}
}

export const HTTP_FAKES: Record<string, () => {client: Record<string, unknown>; requests: unknown[][]}> = {
  salesforce: () => httpFake('salesforce'),
  servicenow: () => httpFake('servicenow'),
  docusign: () => httpFake('docusign'),
  agentforce: () => httpFake('agentforce'),
  google: () => httpFake('google'),
}

export const SESSION_FAKES: Record<string, {live: () => unknown; fresh: () => unknown}> = {
  salesforce: {live: () => ({accessToken: 'tok', instanceUrl: 'https://example.invalid'}), fresh: () => ({})},
  docusign: {live: () => ({exportSession: () => ({accessToken: 'tok', expiresAt: Math.floor(Date.now() / 1000) + 3600})}), fresh: () => ({exportSession: () => undefined})},
}

/** Commands that need no client at all; they answer without credentials by design. */
export const NO_CLIENT: Record<string, string> = {
  'google:discover': 'static catalogue of services and auth methods, no API call',
  'google:drive:view-url': 'formats a Drive URL locally, no API call',
}
