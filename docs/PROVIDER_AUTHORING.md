# Adding a Provider

This guide walks through adding a provider, using a fictional SaaS product called **Acme Widgets** that exposes a REST API with HTTP Basic auth. By the end you will have a provider with two commands, a credential schema, error hints, a tenant walk, fixture tests, and a passing conformance suite.

Throughout, `$BIN` stands for the installed binary name. Examples in code use the literal `$BIN` token; the base command substitutes the real name whenever it prints.

## What a provider is

A provider is one directory under `src/providers/<tier>/<name>/` that exports a single `ProviderPlugin` object through `defineProvider()`. The plugin declares everything the core needs to know about the provider. The core then derives auth flags, environment variable handling, config profiles, the `discover` and `learn` briefings, health probing, session caching, and the "no credentials" error, so provider code never touches `process.env`, never parses auth flags, and never builds its own connection cache.

Provider code is responsible for three things only:

1. Talking to the API: a client class and a factory that authenticates it.
2. Commands: one class per operation, each carrying its safety metadata and examples.
3. Knowledge: a briefing for agents, error hints, and optionally a tenant walk over the customer's customizations.

### Tiers

| Tier | Directory | Who maintains | Ships in upstream releases |
|---|---|---|---|
| `native` | `src/providers/native/<name>/` | Project maintainers | Yes |
| `contributed` | `src/providers/contributed/<name>/` | The people named in `plugin.maintainers` | Yes |
| `private` | `src/providers/private/<name>/` | A fork, for its own use | No |

Tier is a property of the path. The index generator reads the directories, the registry records the tier, and `discover` and `learn` show it. A plugin cannot declare its own tier, and the obligations are the same in every tier: the conformance suite runs over every registered provider. A private provider in a fork is exactly as much a provider as a native one. See [FORKING.md](FORKING.md) for the fork mechanics and the promotion path from private to contributed.

If you are building a CLI on the framework instead of contributing to this repository, the same files go in your CLI package and you pass the plugin to `defineCli()`. See [BUILDING_A_CLI.md](BUILDING_A_CLI.md); everything below applies unchanged. The conformance suite runs there too, from `aclif/testing`; the scaffold writes the test file.

## Authoring philosophy

### Start from the API specification

Almost every SaaS API you will want to expose publishes a machine-readable description of itself. Most publish OpenAPI. The rest publish something equivalent that can be converted or read directly: Salesforce has `describeGlobal` and per-object `describe`, ServiceNow generates OpenAPI from its REST API Explorer, GraphQL APIs carry their own introspection. That document is the authoritative statement of paths, operations, parameters, request and response schemas, auth schemes, and often pagination and rate-limit conventions.

A provider is a mechanical projection of that document onto the command surface this framework defines. The projection is what an authoring agent is good at; the judgment calls are what you review.

### Why not the vendor SDK

Vendor SDKs look like a shortcut and are a liability for this codebase in particular.

1. **They hide the wire.** The error classifier and health monitor key on HTTP status codes and body shapes. An SDK that wraps a 401 in its own exception type breaks the mapping from "what the API said" to "what the agent should do next".
2. **They own auth.** Most SDKs insist on doing the OAuth dance themselves, which fights the credential schema, the session cache, and embedding hosts that hand in resolved credentials per request.
3. **They pull in transitive weight.** A CLI that starts in under a second matters when an agent calls it hundreds of times.
4. **They pin the API version to the SDK release cadence**, which is not yours.
5. **They lie about pagination.** Auto-paginating iterators hide the cursor the agent needs in `nextCommand`.
6. **They serialize to their own types**, and the envelope wants plain JSON.
7. **Drift.** SDKs lag the API they wrap, and the API itself drifts from its published description. A `fetch` client written against the spec, with recorded fixtures, drifts in one place you control.

**The exception, stated precisely.** Dependencies are allowed for protocol and auth mechanics that are not HTTP: signing a JWT grant, encoding protobufs for a gRPC API, an XML parser for a SOAP endpoint. Each one is listed in `src/providers/dependency-allowlist.json` with its reason, and the conformance rule `C-DEP-1` rejects any import that is not on the list. The Salesforce provider's `jsforce` is grandfathered there and marked as follow-on work. A private provider in a fork may extend the list with `src/providers/private/dependency-allowlist.json`.

### Scope is enforced at the tool definition

A provider covers the whole API. Every operation the spec describes becomes a command, with honest metadata. Which of those commands a particular agent may run is decided outside the provider, by whoever configures that agent: an embedding host's capability gate, a policy file, or the tool list handed to the agent. Leaving operations out of the provider to "keep agents safe" only means the next agent that legitimately needs them cannot have them, and it hides the operation from the metadata that governance reads.

### Use a coding agent, and make the conformance suite its acceptance test

The mechanical column is a job for a modern AI coding platform working in this repository. The inputs it needs are all files: the spec, `docs/CONTRACT.md`, this guide, a finished provider to imitate, and the conformance suite. The conformance suite is the acceptance test. When it passes, the mechanical work is done and what remains is the review below.

- Give it the whole spec and ask for the whole API.
- Tell it which provider to imitate. ServiceNow is the cleanest native example; a small provider in your own private tier, once you have one, is the cleanest small one.
- Have it run conformance and the fixture tests itself and iterate. Ask it to report each conformance failure it fixed, since those are the places where the spec and the contract disagreed and you want to know.

### A sample generation prompt

Adapt the bracketed parts. Keep the rest; the constraints are what make the output pass conformance on the first or second attempt.

```text
You are adding a provider to this repository. Read these before writing any code:
  - docs/CONTRACT.md
  - docs/PROVIDER_AUTHORING.md
  - src/providers/native/servicenow/ (a finished provider to imitate; note how thin base.ts is)
  - test/providers/native/servicenow/servicenow.test.ts (the fixture suite to imitate)
  - test/conformance/ (the rules your code must satisfy)

Provider to add:
  name:         [acme]
  displayName:  [Acme Widgets]
  tier:         [private]
  spec:         [specs/acme-openapi.yaml]   (OpenAPI 3.x)
  auth:         [HTTP Basic with an API user; also accepts a bearer token]

Step 1. Run: npm run scaffold-provider -- --tier [private] --name [acme] --display "[Acme Widgets]"

Step 2. Cover the entire spec. Every operation becomes a command. Do not select a
subset. Whoever configures each agent enforces scope later; the provider has no part in it.

Command ids: <provider>:<topic>:<verb>, where topic is the operation's
first tag (fall back to the first path segment after the version) and
verb follows the uniform vocabulary when the operation fits it:
  GET collection         -> list      GET item          -> get
  POST collection        -> create    PUT/PATCH item    -> update
  DELETE item            -> delete    search endpoints  -> search
Anything else keeps the operationId in kebab-case.

For each command:
  - aciMetadata from the operation: mutability from the method, blastRadius
    from whether the path names one record, requiresConfirmation true for
    deletes, all_records operations, and anything that runs code;
    capabilities: ['code_exec'] or ['metadata_change'] where they apply.
    Mark any row you are unsure about with a TODO comment for review.
  - Flags from parameters and the request body schema; required where the
    spec says required. Enumerations become flag options.
  - responseShape from the response schema, with the spec's example.
  - aciExamples: at least one runnable example per command, using the
    spec's example values, the $BIN token, and --json. Mutations that
    require confirmation show --confirm; add a --dry-run example too.
  - Pagination: read the spec's convention (cursor, offset, page token)
    and emit nextCommand as a runnable $BIN string in _context.pagination.
Files:
  - credentials.ts, client.ts (fetch only), errors.ts, metadata.ts,
    base.ts, plugin.ts, commands/**.
  - tenant.ts if the spec has metadata endpoints (see section 8).
  - test/fixtures/[private]/acme/*.json: build from the spec's example
    values. Do not invent fields that are not in the response schema.
  - test/providers/[private]/acme/acme.test.ts: the READ-1, READ-2, READ-3,
    MUT-1, MUT-2, MUT-3, ERR-1..ERR-4, DISC-1, AUTH-1 cases defined by
    test/helpers/provider-suite.ts, for one representative
    list command and one representative mutation per topic, using
    test/helpers/msw.ts and test/helpers/provider-suite.ts.
  - docs/providers/[private]/acme/SETUP.md: a skeleton from the spec's
    securitySchemes descriptions, with TODO markers where a human must add
    admin-console steps.

Constraints:
  - No process.env reads anywhere in src/providers/[private]/acme/.
  - base.ts under 40 lines, no credential logic.
  - No hostnames, emails, tenant names, or file paths from any real
    deployment. Use example.com.
  - Every computed command string starts with the literal $BIN token.
  - Do not modify files outside src/providers/[private]/acme/,
    test/providers/[private]/acme/, test/fixtures/[private]/acme/, and
    docs/providers/[private]/acme/.

Step 3. Run, in order, and iterate until all pass:
  npm run build
  npx vitest run test/conformance
  npx vitest run test/providers/[private]/acme
  npm run golden:capture
  npm test
Report every conformance failure you had to fix and what you changed.
If the spec is ambiguous about pagination, auth precedence, or which
field is the record id, stop and ask.
```

### What to review in generated code

The generated files that need a human read, in order of risk:

1. `credentials.ts`: path order and which fields are secret.
2. The metadata table, especially the rows the agent marked for review. An `update` labeled `read`, or a bulk operation labeled `single_record`, is a governance hole the conformance suite cannot detect from code alone, and anything that permits by property will trust these labels.
3. `errors.ts`: the hints are where product knowledge lives.
4. `aciExamples`: the agent will write correct examples; you add the ones that document traps.
5. `metadata.ts`: tone and length. This is what an agent reads first.

Everything else is checked by conformance, the fixture tests, and the golden capture.

## File checklist

```
src/providers/<tier>/acme/
├── plugin.ts          # the ProviderPlugin object; the only file the registry imports
├── credentials.ts     # CredentialSchema
├── metadata.ts        # ProviderMetadata (learn and discover briefing)
├── client.ts          # AcmeClient + createClient (+ destroyClient)
├── errors.ts          # classifyAcmeError: API errors to AciError with hints
├── tenant.ts          # optional: TenantWalk over the customer's customizations
├── session.ts         # optional: SessionSupport when a login is expensive
├── base.ts            # AcmeBaseCommand, under 40 lines
└── commands/
    ├── discover.ts
    ├── introspect.ts
    ├── schema/        # optional: entities.ts, describe.ts, sample.ts
    └── widgets/
        ├── list.ts
        └── update.ts

test/providers/<tier>/acme/
└── acme.test.ts
test/fixtures/<tier>/acme/
├── widgets-list.json
└── widget-update.json
docs/providers/<tier>/acme/
└── SETUP.md
```

Run `npm run scaffold-provider -- --tier <tier> --name acme --display "Acme Widgets"` to generate the source tree, the setup skeleton, and the empty test and fixture directories. The scaffold writes only under those four prefixes. Nothing else in the repository changes when a provider is added: the index generator (`scripts/gen-provider-index.mjs`, run on install and before every build) finds the directory, and the topic table in `package.json` is regenerated from `metadata.topics` after the build.

## 1. Credential schema

`credentials.ts` declares how the provider authenticates. This is the single source for auth flags, env vars, profile keys, status text, and the credential error.

```ts
import type {CredentialSchema} from '../../../core/provider/credential-schema.js'

export const acmeCredentials: CredentialSchema = {
  fields: {
    instanceUrl: {flag: 'instance-url', env: 'ACME_INSTANCE_URL', description: 'Acme base URL, e.g. https://widgets.example.com'},
    username: {flag: 'acme-username', env: 'ACME_USERNAME', description: 'API user name'},
    password: {flag: 'acme-password', env: 'ACME_PASSWORD', description: 'API user password', secret: true},
    accessToken: {flag: 'access-token', env: 'ACME_ACCESS_TOKEN', description: 'Pre-issued bearer token', secret: true},
  },
  paths: [
    {authType: 'session', requires: ['instanceUrl', 'accessToken'], description: 'Bearer token'},
    {authType: 'credentials', requires: ['instanceUrl', 'username', 'password'], description: 'HTTP Basic with an API user'},
  ],
}
```

Rules:

- Field keys are property names on `ServiceAccountCredentials`. Add a property to that type if the provider needs one that does not exist yet, with a doc comment naming the provider.
- Flag names must not collide with base flags or with any command's own flags (`C-CRED-3`). Prefix provider-specific ones with the provider's short code (`acme-username`) and keep the shared conventions `instance-url` and `access-token`.
- Env names use one upper-case prefix per provider.
- Mark anything that should never appear in output or error text as `secret: true`. The conformance rule `C-CRED-1` insists on it for any field whose name says password, secret, token, or key.
- Paths are tried in order. Put the least privileged or shortest-lived path first.
- `default` on a field supplies a value when nothing else does (an auth server host, an API version).

What the core does with this:

| Derived behavior | Where it shows up |
|---|---|
| `--instance-url`, `--acme-username`, `--acme-password`, `--access-token` flags with env bindings | every `acme` command, `--schema`, `--flags-for auth` |
| `ACME_*` environment resolution, then `profiles.<name>.acme.{instance_url,username,password,access_token}` in `config.yaml` | standalone credential resolution |
| "configured via HTTP Basic with an API user" | `discover`, `learn` |
| exit 3 error listing both paths | any command run without credentials |
| the auth flags listed under `auth` | `--flags-for auth` |

## 2. Client

`client.ts` wraps the API over Node's built-in `fetch`. Do not import the vendor SDK; the reasons are in "Why not the vendor SDK" above, and `C-DEP-1` rejects imports outside the allowlist. Keep the client free of oclif and of the envelope. It receives resolved credentials and returns something the commands can call.

```ts
import {withDnsRetry} from '../../../util/dns-retry.js'
import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'

export interface AcmeListResult<T> {
  items: T[]
  total: number
  nextCursor: string | null
}

export class AcmeClient {
  constructor(readonly baseUrl: string, private readonly authHeader: string) {}

  async list<T = Record<string, unknown>>(collection: string, params: {limit?: number; cursor?: string; search?: string} = {}): Promise<AcmeListResult<T>> {
    const qs = new URLSearchParams()
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.cursor) qs.set('cursor', params.cursor)
    if (params.search) qs.set('q', params.search)
    const body = await this.request<{items: T[]; total: number; next_cursor: string | null}>('GET', `/api/v1/${collection}?${qs}`)
    return {items: body.items, total: body.total, nextCursor: body.next_cursor}
  }

  async patch<T = Record<string, unknown>>(collection: string, id: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', `/api/v1/${collection}/${encodeURIComponent(id)}`, body)
  }

  /** Raw request for manifest commands (plugin.http). */
  async rawRequest(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<unknown> {
    const qs = query ? `?${new URLSearchParams(query)}` : ''
    return this.request<unknown>(method, `${path}${qs}`, body)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await withDnsRetry(() => fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }))
    const text = await res.text()
    if (!res.ok) {
      // Keep the status in parentheses: the shared error classifier keys on "(401)" and friends.
      throw new Error(`Acme ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`)
    }
    if (/^\s*</.test(text)) {
      // A login or maintenance page with a 200 is never an empty result.
      throw new Error(`Acme ${method} ${path} returned HTML instead of JSON: ${text.slice(0, 200)}`)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`Acme ${method} ${path} returned a body that is not valid JSON: ${text.slice(0, 200)}`)
    }
  }
}

export async function createClient(creds: ServiceAccountCredentials): Promise<AcmeClient> {
  const baseUrl = creds.instanceUrl.replace(/\/+$/, '')
  if (creds.authType === 'session' && creds.accessToken) return new AcmeClient(baseUrl, `Bearer ${creds.accessToken}`)
  if (creds.username && creds.password) {
    return new AcmeClient(baseUrl, `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`)
  }
  throw new Error('Insufficient Acme credentials')
}
```

Conventions the classifier and health monitor rely on:

- Include the HTTP status as `(NNN)` in thrown error messages.
- Throw on an HTML body, and include enough of it that the classifier can tell a login page ("log in", "sign in") from a maintenance or hibernation page.
- Wrap network calls in `withDnsRetry` so transient resolver failures are retried.

## 3. Error hints

`errors.ts` turns API failures into errors an agent can act on. Return `undefined` for anything you do not recognize and the generic mapping applies (it already handles "insufficient access", 403, and permission wording). Decide on the HTTP status first; text heuristics run after, and never match on the request URL, which carries the query string.

```ts
import type {AciError} from '../../../core/contract/aci.js'

export function classifyAcmeError(error: unknown): AciError | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message.toLowerCase()
  if (msg.includes('(401)')) {
    return {code: 'AUTHENTICATION_FAILED', message: error.message, syntaxGuide: 'Acme rejected the credentials. Check the API user or token; see docs/providers/<tier>/acme/SETUP.md.'}
  }
  if (msg.includes('(403)')) {
    return {code: 'INSUFFICIENT_ACCESS', message: error.message, syntaxGuide: 'The API user lacks permission for this collection. Run `$BIN acme introspect --json` to see per-collection access.'}
  }
  if (msg.includes('(404)')) {
    return {code: 'NOT_FOUND', message: error.message, workingExample: '$BIN acme widgets list --search "name" --json'}
  }
  if (msg.includes('(422)')) {
    return {code: 'VALIDATION_ERROR', message: error.message, syntaxGuide: 'Run `$BIN acme schema describe widgets --json` to see field names and types.'}
  }
  if (msg.includes('(429)')) {
    return {code: 'RATE_LIMITED', message: error.message, syntaxGuide: 'Wait for the limit window to reset, or narrow the request.'}
  }
  return undefined
}
```

Every hint should name the command that fixes the problem. An error with a hint gives the agent its next action. Error codes matter beyond the text: a code containing `AUTH`, `CREDENTIAL`, or `UNAUTHORIZED` makes the standalone binary exit 3, `CONFIRMATION_REQUIRED` exits 2, and `RATE_LIMITED` or `AUTHENTICATION_FAILED` set the health monitor's classification when embedded.

## 4. Metadata

`metadata.ts` is the briefing an agent reads through `learn acme`. Keep it under about five hundred tokens. `commands` under each topic must match the registered command ids exactly; `C-DOC-1` checks both directions. Commands at the provider root (`acme:discover`, `acme:introspect`) are not listed under a topic.

```ts
import type {ProviderMetadata} from '../../../core/contract/aci.js'

export const acmeMetadata: ProviderMetadata = {
  name: 'acme',
  description: 'Acme Widgets inventory and configuration',
  overview: 'Acme Widgets. Core collections: widgets, categories. Read via list, mutate via update. Search is substring on name.',
  querySyntax: 'Cursor paging: pass --cursor from _context.pagination. Search: --search <substring>.',
  providerSpecificFlags: [],   // auth flags are generated from the credential schema; leave empty
  topics: {
    widgets: {
      description: 'List and update widgets',
      commands: ['list', 'update'],
      keyFields: ['id', 'name', 'status', 'price', 'updatedAt'],
      commonPatterns: [
        'List widgets: $BIN acme widgets list --limit 20 --json',
        'Find by name: $BIN acme widgets list --search "gear" --json',
        'Update status: $BIN acme widgets update --id w_123 --values \'{"status":"active"}\' --confirm --json',
      ],
    },
  },
}
```

`commonPatterns` are checked the same way as examples (`C-EX-1`): every one must parse against the command it names, and in the native and contributed tiers must use example.com identities and public hosts (`C-EX-3`).

## 5. Base command

`base.ts` is intentionally tiny. It binds the provider and exposes a typed client getter. All credential resolution happens in the core.

```ts
import {AciBaseCommand} from '../../../cli/base-command.js'
import type {AcmeClient} from './client.js'
import {acmeCredentials} from './credentials.js'

export abstract class AcmeBaseCommand extends AciBaseCommand {
  static override baseFlags = AciBaseCommand.flagsFor(acmeCredentials)

  protected getConnection(): Promise<AcmeClient> {
    return this.getClient<AcmeClient>()
  }
}
```

`AciBaseCommand.flagsFor(schema)` returns the base flags plus the auth flags generated from the credential schema. `getClient()` asks the invocation's credential resolver first when embedded, then flags, environment, and profile when standalone, then hands the result to the connection pool (and to the session cache when the plugin declares `session`). The `provider` static that links a command to its plugin is stamped by `defineProvider()` when the plugin is built, so the base command does not import `plugin.ts` and there is no import cycle.

## 6. Commands

One class per operation under `commands/<topic>/<command>.ts`. Ids are declared explicitly in `plugin.commands`; the convention is that `commands/widgets/list.ts` registers as `acme:widgets:list` and is typed as `$BIN acme widgets list`.

### A read command

```ts
import {Flags} from '@oclif/core'

import {AcmeBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class AcmeWidgetsList extends AcmeBaseCommand {
  static override description = 'List widgets with optional substring search'

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'filtered_set',
    apiCallsConsumed: 1, requiresConfirmation: false, prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [
    {description: 'First page of widgets', command: '$BIN acme widgets list --limit 20 --json', responseShape: {widgets: [{id: 'w_123', name: 'Gear', status: 'active'}], total: 240}},
    {description: 'Search by name', command: '$BIN acme widgets list --search "gear" --json'},
  ]

  static override responseShape: ResponseShape = {
    description: 'Widget rows plus total count',
    fields: {widgets: {type: 'array', description: 'Widget records'}, total: {type: 'integer', description: 'Total matching widgets'}},
    example: {widgets: [{id: 'w_123', name: 'Gear', status: 'active'}], total: 240},
  }

  static override flagCategories: FlagCategorization = {search: ['filtering'], limit: ['filtering', 'pagination'], cursor: ['pagination']}

  static override flags = {
    ...AcmeBaseCommand.baseFlags,
    search: Flags.string({description: 'Substring match on name'}),
    limit: Flags.integer({description: 'Rows per page', default: 50}),
    cursor: Flags.string({description: 'Cursor from a previous _context.pagination.nextCommand'}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(AcmeWidgetsList)
    try {
      const client = await this.getConnection()
      const page = await client.list('widgets', {limit: flags.limit, cursor: flags.cursor, search: flags.search})
      const nextCommand = page.nextCursor
        ? `$BIN acme widgets list${flags.search ? ` --search "${flags.search}"` : ''} --limit ${flags.limit} --cursor ${page.nextCursor} --json`
        : null
      await this.outputResult({widgets: page.items, total: page.total}, this.buildContext({
        returned: page.items.length,
        total: page.total,
        hasMore: Boolean(page.nextCursor),
        nextCommand,
        availableFields: page.items[0] ? Object.keys(page.items[0]) : [],
        relatedCommands: ['$BIN acme schema describe widgets --json'],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
```

Every string that names a command starts with the literal `$BIN` token: examples, `nextCommand`, `relatedCommands`, `workingExample`, hints. The base command's `log()` renders the token as the real binary name at emit time, in the standalone binary and through the embedded runtime alike. Never concatenate a binary name yourself.

`outputResult` applies `--fields`, `--truncate`, and secret masking, then writes the envelope with `_context` (the contract version is stamped automatically). `outputError` writes an error envelope and, standalone, sets the exit code from the error: 3 for authentication codes, 2 for usage codes, 1 otherwise.

### A mutation command

```ts
import {Flags} from '@oclif/core'

import {AcmeBaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, FlagCategorization, ResponseShape} from '../../../../../core/contract/aci.js'

export default class AcmeWidgetsUpdate extends AcmeBaseCommand {
  static override description = 'Update fields on one widget (PATCH)'

  static override aciMetadata: AciMetadata = {
    mutability: 'update', idempotent: true, reversible: false, blastRadius: 'single_record',
    apiCallsConsumed: 1, requiresConfirmation: true, prerequisites: ['API user needs write access to widgets'],
  }

  static override aciExamples: CommandExample[] = [
    {description: 'Preview an update', command: '$BIN acme widgets update --id w_123 --values \'{"status":"active"}\' --dry-run --json'},
    {description: 'Apply it', command: '$BIN acme widgets update --id w_123 --values \'{"status":"active"}\' --confirm --json', responseShape: {widget: {id: 'w_123', status: 'active'}}},
  ]

  static override responseShape: ResponseShape = {
    description: 'The updated widget',
    fields: {widget: {type: 'object', description: 'Widget after the update'}},
    example: {widget: {id: 'w_123', status: 'active'}},
  }

  static override flagCategories: FlagCategorization = {id: ['filtering'], values: ['bulk']}

  static override flags = {
    ...AcmeBaseCommand.baseFlags,
    id: Flags.string({description: 'Widget id', required: true}),
    values: Flags.string({description: 'JSON object of fields to set', required: true}),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    this.registerMutation()
    const {flags} = await this.parse(AcmeWidgetsUpdate)

    let values: Record<string, unknown>
    try {
      values = JSON.parse(flags.values) as Record<string, unknown>
    } catch {
      this.outputError({code: 'INVALID_JSON', message: '--values must be a JSON object', workingExample: '$BIN acme widgets update --id w_123 --values \'{"status":"active"}\' --confirm --json'})
      return
    }

    if (this.isDryRun(flags, {method: 'PATCH', collection: 'widgets', id: flags.id, values})) return

    try {
      const client = await this.getConnection()
      const widget = await client.patch('widgets', flags.id, values)
      await this.outputResult({widget}, this.buildContext({returned: 1, relatedCommands: ['$BIN acme widgets list --json']}))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
```

Rules for mutations:

- Call `this.registerMutation()` first so an interrupt reports a partial operation.
- Call `this.isDryRun()` before creating a client. `C-META-2` runs every mutating command with `--dry-run` under a client stub that throws if touched. If the API offers a server-side validate-only mode that is a stronger check than a local skip, set `static override dryRunMode = 'server' as const` on the class, forward the flag to that mode, and cover it in the provider's fixture tests instead.
- Set `requiresConfirmation: true` for every delete, every `all_records` operation, and anything that runs code on the target, and declare `capabilities: ['code_exec']` or `['metadata_change']` where they apply (`C-META-3`). The prerun policy hook enforces `--confirm` for these; you do not check the flag yourself. If your command needs confirmation for only some inputs (for example, an envelope that is sent instead of saved as a draft), check the flag yourself and report `CONFIRMATION_REQUIRED` before any client use.
- Every example of a command that requires confirmation shows `--confirm` unless it shows `--dry-run`.
- Use PATCH semantics when the API offers them. Document it in the description when PUT would clear fields.

### discover and introspect

Every provider ships `discover` (what is reachable, what topics exist, a permission-light connectivity ping) and `introspect` (an empirical probe of what the credentials can actually do). Both are read commands and both declare a `responseShape` (`C-META-4`). Keep `introspect` read-only unless a permission can only be proven by writing; if you must write a probe record, tag it with a recognizable sentinel and delete it, following the ServiceNow provider, and say so in `prerequisites`.

## 7. Schema commands

If the API has any way to learn field names, add `schema entities`, `schema describe <entity>`, and `schema sample --entity <name>` commands under `commands/schema/`. They are ordinary read commands; the ServiceNow provider's `commands/schema/` directory is the pattern to copy, and `C-DISC-1` requires all three once any of them exists. Prefer real metadata endpoints. When the API has none, or the role cannot read them, use `inferFieldsFromRecord` from `core/discovery/schema-inference.ts` on one sampled row and report `source: 'sample-inference'` so the agent knows the types are guesses.

## 8. Tenant introspection: discovering the customer's customizations

### Two layers of knowledge

Everything in sections 1 to 7 is **platform knowledge**: what the product's API looks like for every customer. It comes from the spec, it is the same for every tenant, and it ships inside the provider.

Real deployments are not the spec. A Salesforce org has custom objects, custom fields on standard objects, managed packages, picklist values, and record types. A ServiceNow instance has custom tables, scoped applications, and ACLs that decide what a given user can read. Even products with a fixed schema have per-tenant permissions and per-account limits. This is **tenant knowledge**. It cannot be generated at authoring time because it does not exist until you point the provider at a real instance with real credentials. An agent that only has platform knowledge will write a query against `Account.Industry` when the customer keeps that data in `Segment__c`.

### What the tenant layer contains

| Item | Salesforce example | ServiceNow example | Source of truth |
|---|---|---|---|
| Custom entities | `Warranty__c` | `u_vendor_contract`, scoped app tables | `describeGlobal`, `sys_db_object` |
| Custom fields on standard entities | `Account.Segment__c` | `incident.u_region` | per-object `describe`, `sys_dictionary` |
| Enumerations | picklist values and their active flag | choice lists | field describe |
| Relationships | lookups, master-detail | reference fields | field describe |

Effective permissions are the job of `introspect`; the catalog holds structure and never holds record data (`C-TEN-2`).

### How it bootstraps against live credentials

The tenant catalog is built once per instance by an explicit command, refreshed on demand, and cached. The sequence is the same for every provider; what differs is the metadata endpoints you call.

1. **Resolve credentials** through the normal path. Read-only metadata access is enough, so the setup document should say what the least privileged credential is.
2. **Walk**: enumerate entities, then describe each. Batch the per-entity calls and respect the product's limits. The default walk covers custom entities plus the provider's `coreEntities`; `--all` widens it (`C-TEN-3`). A full describe of a large org is thousands of calls and is never the default.
3. **Persist** under the binary's cache directory, keyed by the same instance key the connection pool uses (provider, instance URL, identity, auth type), so two tenants never share a catalog.
4. **Surface it** everywhere platform knowledge is surfaced: `learn` adds an instance block listing custom entities, `--schema` on generic commands lists `availableEntities`, and the unknown-entity error can name the closest catalog match.

Standalone, this is `$BIN acme introspect --bootstrap` followed by any command; `--refresh` rebuilds, `--all` widens. Embedded hosts call the walk directly and keep the result wherever they keep tenant state.

### The `tenant.ts` module

```ts
import type {TenantCatalog, TenantWalk, TenantWalkOptions} from '../../../core/provider/tenant.js'
import type {AcmeClient} from './client.js'

export const CORE_ENTITIES = ['widgets', 'categories']

export const acmeTenant: TenantWalk<AcmeClient> = {
  coreEntities: CORE_ENTITIES,
  /** Read-only. Never called implicitly; introspect --bootstrap and embedding hosts call it. */
  async buildCatalog(client: AcmeClient, opts: TenantWalkOptions = {}): Promise<TenantCatalog> {
    const all = await client.listEntities()                                   // GET /api/v1/meta/entities
    const selected = opts.entities
      ? all.filter((e) => opts.entities!.includes(e.name))
      : opts.all ? all : all.filter((e) => e.custom || CORE_ENTITIES.includes(e.name))
    const entities = []
    for (const e of selected) {
      const d = await client.describeEntity(e.name)                             // GET /api/v1/meta/entities/{name}
      entities.push({
        name: d.name, label: d.label, custom: d.custom, provenance: 'metadata' as const,
        fields: d.fields.map((f) => ({name: f.name, label: f.label, type: f.type, custom: f.custom, ...(f.enum ? {enum: f.enum} : {}), ...(f.references ? {references: f.references} : {})})),
      })
    }
    return {provider: 'acme', capturedAt: new Date().toISOString(), entities, permissions: null}
  },
}
```

Declare it as `tenant: acmeTenant` on the plugin and spread `AcmeBaseCommand.tenantFlags` into `introspect`'s flags (that adds `--bootstrap`, `--refresh`, `--all`); call `await this.handleTenantFlags(flags, client)` right after obtaining the client and return when it answers `true`. `TenantCatalog` is a core type shared by all providers so that `learn`, `--schema`, and the alias resolver can read any provider's catalog without provider-specific code; `schemas/tenant-catalog.schema.json` is its published form. If the product has no metadata endpoint, build entries from `inferFieldsFromRecord` on one sampled row and set `provenance: 'sample-inference'`. Do not fabricate a field list from documentation; an absent field is better than an invented one.

### Safety rules for the tenant layer

- Bootstrap is explicit. No command triggers a catalog walk as a side effect of a query.
- Default scope is narrow; `--all` is opt-in.
- The catalog stores names, types, labels, enum values, and relationships. It never stores record data, and never stores anything the credential schema marks `secret`.
- The walk is read-only (`C-TEN-1` runs it under a recording client). Write probes belong to `introspect`, use a sentinel, clean up, and are declared in `prerequisites`.
- One catalog per instance key. Multi-instance deployments of the same product get separate catalogs, which is what lets an alias set map a canonical entity to each instance's native name.

## 9. Sessions and manifests

Two more optional surfaces on the plugin:

- `session: SessionSupport<Client>` when a login is expensive (Salesforce's SOAP login, DocuSign's JWT grant). `save(client)` returns the reusable state (a session token and its expiry, never a credential secret; `C-SEC-2` checks) and `restore(creds, snapshot)` rebuilds a client without logging in. The base command caches snapshots under the cache directory with mode `0600`, invalidates them on a 401, and `auth status` and `auth logout` manage them.
- `http: (client) => HttpAdapter` when the provider should accept declarative command manifests (see [CONFIGURATION.md](CONFIGURATION.md)). One line over the client's raw request method is enough; `C-MAN-3` proves a GET manifest issues exactly one request with the resolved path.

## 10. The plugin object

`plugin.ts` assembles everything. It is the only file the registry imports.

```ts
import {defineProvider} from '../../../core/provider/plugin.js'
import type {ProviderCommandClass} from '../../../core/provider/plugin.js'
import {createClient} from './client.js'
import {acmeCredentials} from './credentials.js'
import {classifyAcmeError} from './errors.js'
import {acmeMetadata} from './metadata.js'
import {acmeTenant} from './tenant.js'
import AcmeDiscover from './commands/discover.js'
import AcmeIntrospect from './commands/introspect.js'
import AcmeWidgetsList from './commands/widgets/list.js'
import AcmeWidgetsUpdate from './commands/widgets/update.js'

export const acmePlugin = defineProvider({
  name: 'acme',
  displayName: 'Acme Widgets',
  description: 'Acme Widgets inventory and configuration',
  maintainers: ['your-github-handle'],        // required in the contributed tier
  metadata: acmeMetadata,
  credentials: acmeCredentials,
  createClient,
  classifyError: classifyAcmeError,
  tenant: acmeTenant,
  http: (client) => ({request: (r) => client.rawRequest(r.method, r.path, r.query, r.body)}),
  healthProbe: ['acme', 'widgets', 'list', '--limit', '1'],
  commands: {
    'acme:discover': AcmeDiscover,
    'acme:introspect': AcmeIntrospect,
    'acme:widgets:list': AcmeWidgetsList,
    'acme:widgets:update': AcmeWidgetsUpdate,
  } as Record<string, ProviderCommandClass>,
})
```

`defineProvider` validates the object at import time (name format, `metadata.name`, credential schema integrity, command id prefixes, that every command has `aciMetadata`, that the health probe names a read command) and stamps the plugin onto every command class. The index generator requires the file to contain `export const <name> = defineProvider(`.

## 11. Tests you must ship

### Fixture-backed tests

`test/providers/<tier>/acme/acme.test.ts`, using `test/helpers/msw.ts` (an msw server that records every request and fails on unhandled ones) and `test/helpers/provider-suite.ts` (a temp config home, the loaded oclif Config, and a runner that executes your command classes in-process):

```ts
import {readFileSync} from 'node:fs'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {assertEnvelope} from '../../../helpers/envelope.js'
import {http, json, settle, startServer} from '../../../helpers/msw.js'
import {parse, providerHarness, type ProviderHarness} from '../../../helpers/provider-suite.js'

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/<tier>/acme/${name}.json`, 'utf8'))
let h: ProviderHarness
const mock = startServer()

beforeAll(async () => {
  h = await providerHarness('acme')
})
afterAll(async () => {
  mock.server.close()
  await h.close()
})
afterEach(async () => {
  mock.reset()
  await h.fresh()
})
const creds = () => h.setEnv({ACME_INSTANCE_URL: 'https://widgets.example.com', ACME_ACCESS_TOKEN: 'tok'})

describe('P-acme', () => {
  it('READ-1: list carries records and pagination', async () => {
    creds()
    mock.server.use(http.get('https://widgets.example.com/api/v1/widgets', () => json(fixture('widgets-list'))))
    const out = await h.run('acme:widgets:list', ['--limit', '2', '--json'])
    expect(out.code, out.stderr).toBe(0)
    const env = assertEnvelope<{widgets: unknown[]}>(parse(out))
    expect(env.result!.widgets).toHaveLength(2)
    expect(env._context).toMatchObject({pagination: {returned: 2, total: 240, hasMore: true}})
  })

  it('MUT-1: --dry-run sends no request', async () => {
    creds()
    const out = await h.run('acme:widgets:update', ['--id', 'w_1', '--values', '{"status":"active"}', '--dry-run'])
    expect(parse(out)).toMatchObject({dryRun: true})
    expect(mock.seen).toEqual([])
  })

  it('MUT-2: --confirm sends PATCH with the body', async () => {
    creds()
    mock.server.use(http.patch('https://widgets.example.com/api/v1/widgets/w_1', () => json(fixture('widget-update'))))
    const out = await h.run('acme:widgets:update', ['--id', 'w_1', '--values', '{"status":"active"}', '--confirm', '--json'])
    expect(out.code, out.stderr).toBe(0)
    await settle()
    expect(JSON.parse(mock.seen[0].body)).toEqual({status: 'active'})
  })

  it('MUT-3: without --confirm the prerun policy exits 2 before any request', async () => {
    creds()
    const out = await h.runWithHooks('acme:widgets:update', ['--id', 'w_1', '--values', '{}', '--json'])
    expect(out.code).toBe(2)
    expect(mock.seen).toEqual([])
  })
})
```

Cover READ-1 to 3, ERR-1 to 4 (401, 403, 429, and an HTML body), MUT-1 to 3, DISC-1, AUTH-1 for each credential path, and TEN-1 and 2 when there is a tenant walk. The four native suites under `test/providers/native/` are complete examples. Fixtures are recorded or spec-derived responses with no real tenant data and example.com identities.

### Conformance

Nothing to write. `test/conformance/` iterates every registered provider. A provider that adds a tenant walk, an http adapter, or session support must add a small recording fake to `test/conformance/tenant.test.ts`; the test names the provider when it is missing.

```bash
npx vitest run test/conformance
```

The failures you will most likely see the first time:

- `C-DOC-1`: a command listed in `metadata.topics` that has no class, or a class not listed.
- `C-EX-1`: an example that uses a flag the command does not declare, or misses a required one.
- `C-META-2`: a mutation that constructs the client before calling `isDryRun`.
- `C-META-3`: a delete or code-executing command with `requiresConfirmation: false`.
- `C-META-4`: a read command without `responseShape`.
- `C-CRED-2`: a command that does not reach the credential check with the flags of its first example (usually an example that fails the command's own input validation).

### Golden introspection

After the provider passes conformance, regenerate the goldens so the contract test knows about the new commands, and review the diff:

```bash
npm run golden:capture
git diff --stat test/contract/golden
```

Commit the generated `test/contract/golden/acme/**` files with the provider. The root `--discover` goldens of `discover`, `learn`, and `version` change too, because the topic list grew; that is expected.

## 12. Setup documentation

`docs/providers/<tier>/acme/SETUP.md` explains how a user obtains credentials: which admin screen, which scopes or roles, the least privileged credential that can run `introspect --bootstrap`, how to verify with `$BIN acme introspect --json`, and how to rotate. Reference it from your error hints. Do not include hostnames, usernames, or paths from any real deployment.

## 13. Pull request checklist

- [ ] `src/providers/<tier>/acme/` matches the file checklist
- [ ] `base.ts` is under 40 lines and contains no credential logic
- [ ] No `process.env` reads anywhere in the provider
- [ ] No vendor API SDK imported; any protocol or auth library is on the allowlist with its reason
- [ ] No literal binary name in examples, hints, or computed commands; `$BIN` only
- [ ] Every mutation calls `registerMutation()` and `isDryRun()` before touching the client
- [ ] Deletes, `all_records`, and code execution have `requiresConfirmation: true` and the matching capability
- [ ] Every read command declares `responseShape`
- [ ] `metadata.topics` matches the command map
- [ ] Fixture tests cover READ-1 to 3, MUT-1 to 3, ERR-1 to 4, DISC-1, AUTH-1
- [ ] `tenant.ts` walk is read-only, scoped by default, and tested against a fixture org
- [ ] SETUP.md names the least privileged credential that can run bootstrap
- [ ] `npx vitest run test/conformance` passes
- [ ] Goldens captured and committed
- [ ] `docs/providers/<tier>/acme/SETUP.md` written
- [ ] CHANGELOG entry under Unreleased (native and contributed tiers)
