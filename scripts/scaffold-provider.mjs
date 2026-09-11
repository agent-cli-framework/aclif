// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
// Scaffold a provider in a tier: node scripts/scaffold-provider.mjs --tier private --name acme [--display "Acme Widgets"]
// Writes only under the tier's four prefixes, then the generator picks it up on the next build.
import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length))
const {tier, name} = args
if (!['native', 'contributed', 'private'].includes(tier) || !/^[a-z][a-z0-9-]*$/.test(name ?? '')) {
  console.error('usage: scaffold-provider --tier native|contributed|private --name <kebab-case> [--display "Display Name"]')
  process.exit(2)
}
const display = args.display ?? name[0].toUpperCase() + name.slice(1)
const dir = join('src/providers', tier, name)
if (existsSync(dir)) {
  console.error(`${dir} already exists`)
  process.exit(1)
}
const ENV = name.replace(/-/g, '_').toUpperCase()
const sym = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const Sym = sym[0].toUpperCase() + sym.slice(1)
const files = {
  'credentials.ts': `import type {CredentialSchema} from '../../../core/provider/credential-schema.js'

export const ${sym}Credentials: CredentialSchema = {
  fields: {
    instanceUrl: {flag: 'instance-url', env: '${ENV}_INSTANCE_URL', description: '${display} base URL'},
    accessToken: {flag: 'access-token', env: '${ENV}_ACCESS_TOKEN', description: 'Pre-issued bearer token', secret: true},
  },
  paths: [{authType: 'session', requires: ['instanceUrl', 'accessToken'], description: 'Bearer token'}],
}
`,
  'client.ts': `import {withDnsRetry} from '../../../util/dns-retry.js'
import type {ServiceAccountCredentials} from '../../../core/contract/aci.js'

export class ${Sym}Client {
  constructor(private readonly baseUrl: string, private readonly authHeader: string) {}

  async list<T = Record<string, unknown>>(collection: string, params: {limit?: number} = {}): Promise<{items: T[]}> {
    const qs = params.limit ? \`?limit=\${params.limit}\` : ''
    return this.request<{items: T[]}>('GET', \`/api/v1/\${collection}\${qs}\`)
  }

  async rawRequest(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<unknown> {
    const qs = query ? \`?\${new URLSearchParams(query).toString()}\` : ''
    return this.request<unknown>(method, \`\${path}\${qs}\`, body)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await withDnsRetry(() => fetch(\`\${this.baseUrl}\${path}\`, {
      method,
      headers: {Authorization: this.authHeader, Accept: 'application/json', ...(body !== undefined ? {'Content-Type': 'application/json'} : {})},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }))
    const text = await res.text()
    if (!res.ok) throw new Error(\`${display} API error (\${res.status}) \${method} \${path}: \${text.slice(0, 500)}\`)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(\`${display} API returned non-JSON for \${method} \${path}: \${text.slice(0, 200)}\`)
    }
  }
}

export async function createClient(creds: ServiceAccountCredentials): Promise<${Sym}Client> {
  if (!creds.accessToken) throw new Error('Insufficient ${display} credentials')
  return new ${Sym}Client(creds.instanceUrl.replace(/\\/+$/, ''), \`Bearer \${creds.accessToken}\`)
}
`,
  'errors.ts': `import type {AciError} from '../../../core/contract/aci.js'

/** ${display} error hints; undefined means use the generic mapping. */
export function classify${Sym}Error(error: unknown): AciError | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message.toLowerCase()
  if (msg.includes('(401)')) return {code: 'AUTHENTICATION_FAILED', message: error.message, syntaxGuide: 'Check --instance-url and --access-token.'}
  return undefined
}
`,
  'metadata.ts': `import type {ProviderMetadata} from '../../../core/contract/aci.js'

export const ${sym}Metadata: ProviderMetadata = {
  name: '${name}',
  description: '${display} operations',
  overview: '${display}. Describe the core entities and how to query them here.',
  querySyntax: 'Describe the query language or filter syntax here.',
  providerSpecificFlags: ['--instance-url — ${display} base URL', '--access-token — bearer token'],
  topics: {
    things: {
      description: 'List things',
      commands: ['list'],
      keyFields: ['id', 'name'],
      commonPatterns: ['List things: $BIN ${name} things list --limit 10 --json'],
    },
  },
}
`,
  'base.ts': `import {AciBaseCommand} from '../../../cli/base-command.js'
import type {${Sym}Client} from './client.js'
import {${sym}Credentials} from './credentials.js'

export abstract class ${Sym}BaseCommand extends AciBaseCommand {
  static baseFlags = AciBaseCommand.flagsFor(${sym}Credentials)

  protected getConnection(): Promise<${Sym}Client> {
    return this.getClient<${Sym}Client>()
  }
}
`,
  'commands/things/list.ts': `import {Flags} from '@oclif/core'

import {${Sym}BaseCommand} from '../../base.js'
import type {AciMetadata, CommandExample, ResponseShape} from '../../../../../core/contract/aci.js'

export default class ${Sym}ThingsList extends ${Sym}BaseCommand {
  static override description = 'List things'

  static override flags = {
    ...${Sym}BaseCommand.baseFlags,
    limit: Flags.integer({description: 'Max things to return', default: 20}),
  }

  static override aciMetadata: AciMetadata = {
    mutability: 'read', idempotent: true, reversible: false, blastRadius: 'filtered_set', apiCallsConsumed: 1, requiresConfirmation: false, prerequisites: [],
  }

  static override aciExamples: CommandExample[] = [{description: 'First ten things', command: '$BIN ${name} things list --limit 10 --json'}]

  static override responseShape: ResponseShape | null = {description: 'Things', fields: {things: {type: 'array'}}, example: {things: [{id: '1', name: 'First'}]}}

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(${Sym}ThingsList)
    try {
      const client = await this.getConnection()
      const {items} = await client.list('things', {limit: flags.limit})
      await this.outputResult({things: items}, this.buildContext({returned: items.length, total: null, hasMore: false}))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
`,
  'plugin.ts': `import {defineProvider} from '../../../core/provider/plugin.js'
import type {ProviderCommandClass} from '../../../core/provider/plugin.js'
import {createClient} from './client.js'
import ${Sym}ThingsList from './commands/things/list.js'
import {${sym}Credentials} from './credentials.js'
import {classify${Sym}Error} from './errors.js'
import {${sym}Metadata} from './metadata.js'

export const ${sym}Plugin = defineProvider({
  name: '${name}',
  displayName: '${display}',
  description: '${display} operations',
${tier === 'contributed' ? "  maintainers: ['your-github-handle'],\n" : ''}  metadata: ${sym}Metadata,
  credentials: ${sym}Credentials,
  createClient,
  classifyError: classify${Sym}Error,
  http: (client) => ({request: (r) => client.rawRequest(r.method, r.path, r.query, r.body)}),
  healthProbe: ['${name}', 'things', 'list', '--limit', '1'],
  commands: {
    '${name}:things:list': ${Sym}ThingsList,
  } as Record<string, ProviderCommandClass>,
})
`,
}
for (const [rel, content] of Object.entries(files)) {
  const path = join(dir, rel)
  mkdirSync(join(path, '..'), {recursive: true})
  writeFileSync(path, content)
}
for (const extra of [join('docs/providers', tier, name), join('test/providers', tier, name), join('test/fixtures', tier, name)]) mkdirSync(extra, {recursive: true})
writeFileSync(join('docs/providers', tier, name, 'SETUP.md'), `# ${display} setup

The \`${name}\` provider authenticates with a pre-issued bearer token. \`$BIN\` stands for your CLI's binary name.

## Credential path

| Field | Flag and variable | What it is |
|---|---|---|
| Instance URL | \`--instance-url\`, \`${ENV}_INSTANCE_URL\` | the ${display} base URL, no trailing slash |
| Access token | \`--access-token\`, \`${ENV}_ACCESS_TOKEN\` | a bearer token; say here which screen issues it and what it must be allowed to do |

## Verify

\`\`\`bash
export ${ENV}_INSTANCE_URL=https://example.com ${ENV}_ACCESS_TOKEN=...
$BIN ${name} things list --limit 3 --json
\`\`\`

## Rotation

Issue a new token, replace \`${ENV}_ACCESS_TOKEN\`; the provider caches no session.
`)
console.log(`scaffolded ${dir} (${tier}); docs/providers/${tier}/${name}/SETUP.md; run npm run build`)
