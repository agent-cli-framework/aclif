// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * ACI (Agent Command Interface) type definitions for ACI.
 */

/** Mutability level of a command */
export type Mutability = 'read' | 'create' | 'update' | 'delete'

/** Scope of records affected by a command */
export type BlastRadius = 'single_record' | 'filtered_set' | 'all_records'

/** ACI metadata declared on every command */
/** Dangerous things a command can do beyond plain data access; policy can require confirmation by capability. */
export type Capability = 'code_exec' | 'metadata_change' | 'bulk'

export interface AciMetadata {
  mutability: Mutability
  idempotent: boolean
  reversible: boolean
  blastRadius: BlastRadius
  apiCallsConsumed: number
  requiresConfirmation: boolean
  prerequisites: string[]
  capabilities?: Capability[]
}

/** Pagination info embedded in response _context */
export interface PaginationContext {
  returned: number
  total: number | null
  hasMore: boolean
  nextCommand: string | null
}

/** Rate limit info embedded in response _context */
export interface RateLimitContext {
  remaining: number
  limit: number
  resetsAt: string | null
}

/** Response context appended to every command output */
export interface ResponseContext {
  /** Contract version the envelope conforms to; stamped by the base command. */
  contract?: string
  pagination: PaginationContext | null
  rateLimit: RateLimitContext | null
  availableFields: string[]
  refinements: string[]
  relatedCommands: string[]
  /** Set when the command was synthesised from a manifest. */
  source?: 'manifest'
  /** Set when --canonical resolved the entity through an alias set. */
  canonical?: {set: string; entity: string; native: string; instance: string}
}

/** Structured ACI error with recovery hints */
export interface AciError {
  code: string
  message: string
  correctedValue?: string
  syntaxGuide?: string
  workingExample?: string
}

/** Semi-structured intent envelope from Agent LLM */
export interface IntentEnvelope {
  system: string
  intent: string
  entity: string
  criteria?: string
  fieldsOfInterest?: string[]
  limit?: number
  body?: Record<string, unknown>
  recordId?: string
}

/** Service account credentials from Credential Vault */
export interface ServiceAccountCredentials {
  instanceUrl: string
  username?: string
  password?: string
  securityToken?: string
  clientId?: string
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  /** Salesforce: login URL for username/password auth (login.salesforce.com, test.salesforce.com, or the My Domain URL) */
  loginUrl?: string
  /** Google: Service Account JSON key (stringified) */
  serviceAccountKey?: string
  /** Google: Email of the user to impersonate via Domain-Wide Delegation */
  delegatedUser?: string
  /** DocuSign: Integration Key (OAuth client_id) */
  integrationKey?: string
  /** DocuSign: API user GUID to impersonate via JWT Grant */
  impersonatedUserId?: string
  /** DocuSign: API account GUID (tenant in the REST URL path) */
  dsAccountId?: string
  /** DocuSign: RSA private key PEM used to sign the JWT assertion */
  privateKey?: string
  /** DocuSign: OAuth auth server host (account-d.docusign.com | account.docusign.com) */
  authServer?: string
  /** Agentforce: default agent ID for `sessions start` when none is supplied */
  defaultAgentId?: string
  /** Google Ads: developer token from the manager account's API Center (sent as `developer-token` header) */
  developerToken?: string
  /** Google Ads: manager (MCC) customer ID, digits only — sent as `login-customer-id` header when accessing client accounts */
  loginCustomerId?: string
  /** Google Ads: default operating customer ID when a command omits --customer-id */
  defaultCustomerId?: string
  /** LinkedIn Ads: API version string (YYYYMM) sent as the `LinkedIn-Version` header */
  liVersion?: string
  /** LinkedIn Ads: default ad account (numeric ID or sponsoredAccount URN) when a command omits --account */
  defaultAccountId?: string
  authType: 'credentials' | 'oauth2' | 'session' | 'service-account' | 'jwt-grant' | 'client-credentials'
}

/** Discovered custom object schema */
export interface DiscoveredObject {
  apiName: string
  label: string
  labelPlural: string
  custom: boolean
  keyPrefix: string
  queryable: boolean
  createable: boolean
  updateable: boolean
  deletable: boolean
  fields: DiscoveredField[]
  childRelationships: ChildRelationship[]
}

/** Discovered field metadata */
export interface DiscoveredField {
  name: string
  label: string
  type: string
  length: number
  nillable: boolean
  createable: boolean
  updateable: boolean
  defaultValue: unknown
  picklistValues: PicklistValue[]
  referenceTo: string[]
  relationshipName: string | null
  externalId: boolean
  unique: boolean
  calculated: boolean
}

/** Picklist value for enum fields */
export interface PicklistValue {
  value: string
  label: string
  active: boolean
  defaultValue: boolean
}

/** Child relationship metadata */
export interface ChildRelationship {
  childSObject: string
  field: string
  relationshipName: string | null
}

// --- ACI Introspection Types ---

/** Example usage with optional response shape for --examples flag */
export interface CommandExample {
  description: string
  command: string
  responseShape?: Record<string, unknown>
}

/** Response structure preview for --shape flag */
export interface ResponseShape {
  description: string
  fields: Record<string, {type: string; nullable?: boolean; description?: string}>
  example: Record<string, unknown>
}

/** Flag use-case categories for --flags-for flag */
export type FlagCategory = 'filtering' | 'output' | 'pagination' | 'auth' | 'bulk'

/** Maps flag names to their use-case categories */
export interface FlagCategorization {
  [flagName: string]: FlagCategory[]
}

/** Version history entry for --changelog flag */
export interface CommandChangelog {
  version: string
  date: string
  changes: string[]
}

/** Provider metadata for learn command and --discover */
export interface ProviderMetadata {
  name: string
  description: string
  overview: string
  querySyntax: string
  providerSpecificFlags: string[]
  topics: Record<string, ProviderTopicMetadata>
}

/** Topic-level metadata within a provider */
export interface ProviderTopicMetadata {
  description: string
  commands: string[]
  keyFields: string[]
  commonPatterns: string[]
}
