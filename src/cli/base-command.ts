// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Command, Errors, Flags, Interfaces, ux} from '@oclif/core'

import type {
  AciError,
  AciMetadata,
  CommandChangelog,
  CommandExample,
  FlagCategorization,
  FlagCategory,
  ResponseContext,
  ResponseShape,
  ServiceAccountCredentials,
} from '../core/contract/aci.js'
import {IDENTITY_TOKEN_ENV} from '../core/identity/index.js'
import {credentialsFromSchema, describePaths, mergeValues, valuesFromFlags, type CredentialSchema} from '../core/provider/credential-schema.js'
import {flagsFromSchema} from '../core/provider/flags.js'
import type {ProviderPlugin} from '../core/provider/plugin.js'
import {getProcessPool} from '../core/runtime/process-pool.js'
import {instanceKey, type TenantCache, type TenantCatalog} from '../core/provider/tenant.js'
import {FileTenantCache} from './config/tenant-cache.js'
import {FileSessionCache} from './config/session-cache.js'
import {isExpired} from '../core/credentials/session-cache.js'
import {classifyError} from '../core/errors/classifier.js'
import {invert, nearestCanonical, type AliasStore} from '../core/alias/alias-set.js'
import {FileAliasStore} from './config/alias-store.js'
import {getCommandContext} from '../core/command-context.js'
import {renderBin} from '../core/output/render-bin.js'
import {valuesFromEnv} from '../core/provider/credential-schema.js'
import {maskSensitiveFields} from '../core/output/masking.js'
import {registerOperation} from './sigint-handler.js'
import {setCommandOutcome} from './outcome.js'
import {exitCodeForError} from '../core/errors/exit-codes.js'
import type {Invocation} from '../core/runtime/invocation.js'
import {AciRuntimeError, isAciRuntimeError} from '../core/errors/runtime-error.js'
import {CONTRACT_VERSION} from '../core/contract/version.js'

/**
 * True for errors that carry an exit code and must propagate: oclif's
 * ExitError (from this.exit / this.error) and the embedded runtime's
 * AciRuntimeError. Commands catch broadly around provider calls; without
 * this check a deliberate exit 3 would be reported as COMMAND_ERROR and
 * the process would exit 0.
 */
/** Colours for --pretty when the CLI ships no theme of its own. */
const PRETTY_JSON_THEME = {key: 'cyan', string: 'green', number: 'yellow', boolean: 'magenta', null: 'gray'}

export function isExitError(error: unknown): boolean {
  if (isAciRuntimeError(error)) return true
  return Boolean(error && typeof error === 'object' && 'oclif' in error && typeof (error as {oclif?: {exit?: unknown}}).oclif?.exit === 'number')
}

export type InferredFlags<T> = Interfaces.InferredFlags<typeof AciBaseCommand.baseFlags & T>


/**
 * Base command for all ACI commands. Provides:
 * - Standard ACI flags (--json, --dry-run, --fields, etc.)
 * - ACI introspection flags (--schema, --examples, --shape, --discover, --flags-for, --changelog, --estimate)
 * - ACI metadata declaration
 * - Credential injection from vault
 * - Structured error formatting with recovery hints
 * - Response context building (pagination, rate limits, refinements)
 * - Dual-identity audit logging
 */
export abstract class AciBaseCommand extends Command {
  /** Standard ACI flags available on every command */
  static baseFlags = {
    json: Flags.boolean({
      description: 'Output as JSON',
      default: true,
    }),
    fields: Flags.string({
      description: 'Comma-separated fields to return',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview the operation without executing',
      default: false,
    }),
    estimate: Flags.boolean({
      description: 'Estimate response size without executing',
      default: false,
    }),
    diff: Flags.boolean({
      description: 'Show only changed fields (for mutations)',
      default: false,
    }),
    truncate: Flags.integer({
      description: 'Max records to return',
    }),
    full: Flags.boolean({
      description: 'Include sensitive values in output (passwords, tokens)',
      default: false,
    }),
    pretty: Flags.boolean({
      description: 'Colored output for human reading',
      default: false,
    }),
    schema: Flags.boolean({
      description: 'Output command schema as JSON',
      default: false,
    }),
    changelog: Flags.boolean({
      description: 'Output command version history',
      default: false,
    }),
    discover: Flags.boolean({
      description: 'List available sub-topics and commands',
      default: false,
    }),
    examples: Flags.boolean({
      description: 'Show usage examples with response shapes',
      default: false,
    }),
    shape: Flags.boolean({
      description: 'Preview response structure without executing',
      default: false,
    }),
    'flags-for': Flags.string({
      description: 'Show flags for a use case: filtering, output, pagination, auth, bulk',
      options: ['filtering', 'output', 'pagination', 'auth', 'bulk'],
    }),
    profile: Flags.string({
      description: 'Named profile from the config file',
      env: 'ACLIF_PROFILE',
    }),
    instance: Flags.string({
      description: 'Named instance within the profile, for providers with more than one; embedding hosts pass it through',
      env: 'ACLIF_INSTANCE',
    }),
    confirm: Flags.boolean({
      description: 'Confirm a command that requires explicit confirmation',
      default: false,
    }),
    'identity-token': Flags.string({
      description: 'Identity token verified by the configured identity provider',
      env: IDENTITY_TOKEN_ENV,
    }),
  }

  /**
   * The provider this command belongs to. Set by each provider's base
   * class; undefined for core commands such as discover and learn. Named
   * `provider` because oclif's Command reserves the static `plugin` for
   * the loaded oclif plugin.
   */
  static provider?: ProviderPlugin

  /** Base flags plus the auth flags generated from a credential schema. */
  static flagsFor(schema: CredentialSchema): typeof AciBaseCommand.baseFlags & Record<string, Interfaces.OptionFlag<string | undefined>> {
    return {...AciBaseCommand.baseFlags, ...flagsFromSchema(schema)} as typeof AciBaseCommand.baseFlags &
      Record<string, Interfaces.OptionFlag<string | undefined>>
  }

  /** Flags an `introspect` command spreads in when its provider offers a tenant walk. */
  static tenantFlags = {
    bootstrap: Flags.boolean({description: 'Capture this instance\'s tenant catalogue (custom entities, fields, enumerations) into the cache', default: false}),
    refresh: Flags.boolean({description: 'Recapture the tenant catalogue even if one is cached', default: false}),
    all: Flags.boolean({description: 'Widen the tenant walk beyond custom entities and the provider core entities', default: false}),
  }

  /** Flag a data or schema command spreads in to accept canonical entity and field names. */
  static canonicalFlags = {
    canonical: Flags.boolean({description: 'Treat entity and field names as canonical names and resolve them through the alias sets in force', default: false}),
  }

  /**
   * How --dry-run is honoured: 'local' commands return the preview from
   * isDryRun() before any client use (C-META-2 proves it); 'server'
   * commands pass the flag to an API validate-only mode, which is a
   * stronger check when the provider offers one (Google Ads validateOnly).
   */
  static dryRunMode: 'local' | 'server' = 'local'

  /** ACI metadata — subclasses override this */
  static aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 1,
    requiresConfirmation: false,
    prerequisites: [],
  }

  /** Introspection metadata — subclasses override these */
  static aciExamples: CommandExample[] = []
  static responseShape: ResponseShape | null = null
  static flagCategories: FlagCategorization = {}
  static commandChangelog: CommandChangelog[] = []

  /** Tracks whether an introspection flag short-circuited execution */
  private introspectionHandled = false

  /** Credentials getClient() resolved for this invocation; drives the instance key. */
  protected resolvedCredentials?: ServiceAccountCredentials

  /**
   * Invocation set by the embedded runtime BEFORE init()/run() are called.
   * When present, the command is running inside a host (gateway) and should
   * use invocation.credentials, invocation.pool, and invocation.reporter
   * instead of process.env / module-globals / process.stdout.
   *
   * When absent (the standalone CLI binary), commands fall back to the
   * existing behavior — flags/env vars for credentials, the per-provider
   * module-global pool, and this.log() → process.stdout.
   *
   * Subclasses (provider base commands) read this via the `invocation`
   * accessor below.
   */
  public __invocation?: Invocation

  /** Every line this command prints has $BIN rendered as the configured binary name. */
  override log(message = '', ...args: unknown[]): void {
    super.log(typeof message === 'string' ? renderBin(message, this.config.bin) : message, ...args)
  }

  /** Render $BIN in a string destined for this.error() or this.warn(), which bypass log(). */
  protected render(text: string): string {
    return renderBin(text, this.config.bin)
  }

  /** Public accessor for the runtime-injected invocation, if any. */
  protected get invocation(): Invocation | undefined {
    return this.__invocation
  }

  /**
   * oclif init lifecycle — runs before run().
   * Checks for introspection flags in raw argv to avoid required-flag validation,
   * then short-circuits if any are present.
   */
  async init(): Promise<void> {
    await super.init()

    // Check raw argv for introspection flags BEFORE parsing — this avoids
    // oclif's required-flag validation (e.g., --query is required on data query,
    // but we don't need it when the user just wants --examples or --schema).
    const argv = this.argv
    if (argv.includes('--schema')) { await this.handleSchema(); return }
    if (argv.includes('--examples')) { this.handleExamples(); return }
    if (argv.includes('--shape')) { this.handleShape(); return }
    if (argv.includes('--changelog')) { this.handleChangelog(); return }
    if (argv.includes('--discover')) { this.handleDiscover(); return }
    if (argv.includes('--estimate')) { this.handleEstimate(); return }

    const flagsForIdx = argv.indexOf('--flags-for')
    if (flagsForIdx !== -1 && flagsForIdx + 1 < argv.length) {
      this.handleFlagsFor(argv[flagsForIdx + 1] as FlagCategory)
      return
    }

    // The selected config profile is applied to the environment by the init
    // hook (standalone only), before this instance exists.
  }

  /**
   * Override run to skip execution when an introspection flag was handled.
   */
  protected shouldSkipExecution(): boolean {
    return this.introspectionHandled
  }

  /**
   * Register the current command as a mutation for SIGINT handling.
   * Call this at the start of run() in mutation commands.
   */
  protected registerMutation(): void {
    const cmd = this.constructor as typeof AciBaseCommand
    const commandId = (cmd as unknown as {id?: string}).id || cmd.name
    registerOperation(commandId, cmd.aciMetadata.mutability)
  }

  // --- Introspection Handlers ---

  /**
   * --schema: Output full command schema as JSON.
   */
  private async handleSchema(): Promise<void> {
    const cmd = this.constructor as typeof AciBaseCommand
    const commandId = (cmd as unknown as {id?: string}).id || cmd.name

    // Build flags schema from oclif flag definitions
    const flagsSchema: Record<string, unknown> = {}
    const allFlags = (cmd as unknown as {flags?: Record<string, unknown>}).flags || {}
    for (const [name, def] of Object.entries(allFlags)) {
      const flagDef = def as Record<string, unknown>
      flagsSchema[name] = {
        type: flagDef.type || 'boolean',
        description: flagDef.description,
        required: flagDef.required || false,
        ...(flagDef.default !== undefined ? {default: flagDef.default} : {}),
        ...(flagDef.options ? {options: flagDef.options} : {}),
        ...(flagDef.char ? {char: flagDef.char} : {}),
      }
    }

    // Build args schema
    const argsSchema: Record<string, unknown> = {}
    const allArgs = (cmd as unknown as {args?: Record<string, unknown>}).args || {}
    for (const [name, def] of Object.entries(allArgs)) {
      const argDef = def as Record<string, unknown>
      argsSchema[name] = {
        description: argDef.description,
        required: argDef.required || false,
        ...(argDef.options ? {options: argDef.options} : {}),
      }
    }

    // When a tenant catalogue is cached for the configured instance, list
    // its entities so a design-time reader can name custom objects.
    const catalog = await this.tenantCatalogFromEnv()

    this.log(JSON.stringify({
      command: commandId,
      description: cmd.description,
      flags: flagsSchema,
      args: argsSchema,
      aciMetadata: cmd.aciMetadata,
      ...(catalog ? {availableEntities: catalog.entities.map((e) => e.name), tenantCapturedAt: catalog.capturedAt} : {}),
    }, null, 2))

    this.introspectionHandled = true
    this.exit(0)
  }

  /**
   * --examples: Output usage examples with response shapes.
   */
  private handleExamples(): void {
    const cmd = this.constructor as typeof AciBaseCommand
    const commandId = (cmd as unknown as {id?: string}).id || cmd.name

    this.log(JSON.stringify({
      command: commandId,
      examples: cmd.aciExamples.length > 0
        ? cmd.aciExamples
        : [{description: 'No examples defined yet', command: `$BIN ${commandId.replace(/:/g, ' ')} --help`}],
    }, null, 2))

    this.introspectionHandled = true
    this.exit(0)
  }

  /**
   * --shape: Preview response structure without executing.
   */
  private handleShape(): void {
    const cmd = this.constructor as typeof AciBaseCommand
    const commandId = (cmd as unknown as {id?: string}).id || cmd.name

    if (cmd.responseShape) {
      this.log(JSON.stringify({
        command: commandId,
        responseShape: cmd.responseShape,
      }, null, 2))
    } else {
      this.log(JSON.stringify({
        command: commandId,
        responseShape: {
          description: 'Standard ACI response envelope',
          fields: {
            success: {type: 'boolean', description: 'Whether the operation succeeded'},
            result: {type: 'object', description: 'Command-specific result data'},
            _context: {type: 'object', nullable: true, description: 'Pagination, rate limits, refinements'},
          },
          example: {success: true, result: {}, _context: null},
        },
      }, null, 2))
    }

    this.introspectionHandled = true
    this.exit(0)
  }

  /**
   * --changelog: Output command version history.
   */
  private handleChangelog(): void {
    const cmd = this.constructor as typeof AciBaseCommand
    const commandId = (cmd as unknown as {id?: string}).id || cmd.name

    this.log(JSON.stringify({
      command: commandId,
      changelog: cmd.commandChangelog.length > 0
        ? cmd.commandChangelog
        : [{version: '0.1.0', date: '2026-03-01', changes: ['Initial release']}],
    }, null, 2))

    this.introspectionHandled = true
    this.exit(0)
  }

  /**
   * --discover: List sibling commands and sub-topics for the current command's topic.
   */
  private handleDiscover(): void {
    const cmd = this.constructor as typeof AciBaseCommand
    const commandId = (cmd as unknown as {id?: string}).id || cmd.name

    // Determine the topic (parent path) of this command
    const parts = commandId.split(':')
    const topic = parts.slice(0, -1).join(':')

    // Sibling commands (same topic), sorted by id: oclif's plugin load order
    // is not stable, so an unsorted list drifts between runs.
    const siblingCommands = this.config.commands
      .filter(c => {
        const cParts = c.id.split(':')
        const cTopic = cParts.slice(0, -1).join(':')
        return cTopic === topic && !c.hidden
      })
      .map(c => ({
        command: c.id,
        description: c.description || '',
        aciMetadata: (c as unknown as {aciMetadata?: AciMetadata}).aciMetadata || null,
      }))
      .sort((a, b) => a.command.localeCompare(b.command))

    // Child topics of this command's topic, sorted by name. config.topics is
    // an array of {name, description}; indexing it as an object produced
    // numeric topic names in earlier releases.
    const topicPrefix = topic ? `${topic}:` : ''
    const childTopics = this.config.topics
      .filter(t => {
        if (!topicPrefix) return !t.name.includes(':')
        return t.name.startsWith(topicPrefix) && t.name.slice(topicPrefix.length).split(':').length === 1
      })
      .map(t => ({
        topic: t.name,
        description: t.description || '',
      }))
      .sort((a, b) => a.topic.localeCompare(b.topic))

    this.log(JSON.stringify({
      currentCommand: commandId,
      topic: topic || '(root)',
      siblingCommands,
      childTopics,
      suggestedStart: siblingCommands.length > 0
        ? `$BIN ${siblingCommands[0].command.replace(/:/g, ' ')} --schema --json`
        : null,
    }, null, 2))

    this.introspectionHandled = true
    this.exit(0)
  }

  /**
   * --flags-for <category>: Show flags relevant to a specific use case.
   */
  private handleFlagsFor(category: FlagCategory): void {
    const cmd = this.constructor as typeof AciBaseCommand
    const commandId = (cmd as unknown as {id?: string}).id || cmd.name
    const categorization = cmd.flagCategories

    // Get all flags that belong to this category
    const matchingFlags: Record<string, unknown> = {}
    const allFlags = (cmd as unknown as {flags?: Record<string, unknown>}).flags || {}

    for (const [flagName, categories] of Object.entries(categorization)) {
      if (categories.includes(category) && allFlags[flagName]) {
        const flagDef = allFlags[flagName] as Record<string, unknown>
        matchingFlags[flagName] = {
          type: flagDef.type || 'boolean',
          description: flagDef.description,
          required: flagDef.required || false,
          ...(flagDef.default !== undefined ? {default: flagDef.default} : {}),
          ...(flagDef.options ? {options: flagDef.options} : {}),
        }
      }
    }

    // If no categorization defined, provide sensible defaults based on flag names
    if (Object.keys(categorization).length === 0) {
      // Credential flags come from the provider's CredentialSchema, so the
      // schema (and the env binding every generated flag carries) decides
      // the auth category rather than a list of names.
      const schemaFlags = new Set(Object.values(cmd.provider?.credentials.fields ?? {}).map((f) => f.flag).filter(Boolean))
      for (const [flagName, def] of Object.entries(allFlags)) {
        const flagDef = def as Record<string, unknown>
        const inferred = inferFlagCategory(flagName)
        if ((schemaFlags.has(flagName) || flagDef.env) && !inferred.includes('auth')) inferred.push('auth')
        if (inferred.includes(category)) {
          matchingFlags[flagName] = {
            type: flagDef.type || 'boolean',
            description: flagDef.description,
            required: flagDef.required || false,
            ...(flagDef.default !== undefined ? {default: flagDef.default} : {}),
            ...(flagDef.options ? {options: flagDef.options} : {}),
          }
        }
      }
    }

    this.log(JSON.stringify({
      command: commandId,
      category,
      flags: matchingFlags,
    }, null, 2))

    this.introspectionHandled = true
    this.exit(0)
  }

  /**
   * --estimate: Estimate response size and token cost without executing.
   */
  private handleEstimate(): void {
    const cmd = this.constructor as typeof AciBaseCommand
    const commandId = (cmd as unknown as {id?: string}).id || cmd.name
    const shape = cmd.responseShape

    const fieldCount = shape ? Object.keys(shape.fields).length : 5
    // Rough heuristic: ~15 tokens per field per record, plus envelope overhead
    const estimatedTokensPerRecord = fieldCount * 15
    const envelopeOverhead = 50

    this.log(JSON.stringify({
      command: commandId,
      estimate: {
        fieldsPerRecord: fieldCount,
        tokensPerRecord: estimatedTokensPerRecord,
        envelopeOverhead,
        note: 'Actual size depends on record count and field content. Use --truncate to limit records.',
        suggestion: `Add --truncate 10 to cap at ~${envelopeOverhead + (estimatedTokensPerRecord * 10)} tokens`,
      },
      aciMetadata: {
        apiCallsConsumed: cmd.aciMetadata.apiCallsConsumed,
        mutability: cmd.aciMetadata.mutability,
      },
    }, null, 2))

    this.introspectionHandled = true
    this.exit(0)
  }

  // --- Credential Management ---

  /**
   * Credentials from the embedding host's resolver, when running embedded.
   * Standalone there is no resolver; getClient() reads the schema-driven
   * flags instead.
   */
  protected async getCredentials(serviceName: string): Promise<ServiceAccountCredentials | undefined> {
    return this.invocation ? this.invocation.credentials.get(serviceName) : undefined
  }

  /**
   * An authenticated client for this command's provider.
   *
   * Embedded: the invocation's resolver, then its pool. Standalone: the
   * auth flags (which carry env bindings, and the profile has already been
   * applied to the environment) resolved through the credential schema,
   * then the process-local pool. No credentials at all is exit 3 with the
   * schema's auth paths listed.
   */
  protected async getClient<T = unknown>(): Promise<T> {
    const plugin = (this.constructor as typeof AciBaseCommand).provider
    if (!plugin) throw new Error(`${this.id ?? this.constructor.name} has no provider plugin`)

    if (this.invocation) {
      const creds = await this.invocation.credentials.get(plugin.name)
      if (creds) {
        this.resolvedCredentials = creds
        return this.invocation.pool.getOrCreate<T>(plugin.name, creds)
      }
    }

    const {flags} = await this.parse(this.constructor as typeof AciBaseCommand)
    // Flags carry env bindings for every field that has a flag; env-only
    // fields (a default account id, for instance) come straight from the
    // environment, which the init hook has already filled from the profile.
    const values = mergeValues(valuesFromFlags(plugin.credentials, flags as Record<string, unknown>), valuesFromEnv(plugin.credentials, process.env))
    const resolved = credentialsFromSchema(plugin.credentials, values)
    if (!resolved) this.noCredentialsError(plugin.displayName, describePaths(plugin.credentials))
    this.resolvedCredentials = resolved.credentials

    const pool = this.invocation?.pool ?? getProcessPool()
    if (!pool.hasFactory(plugin.name)) {
      pool.registerFactory(plugin.name, {
        create: (c) => plugin.createClient(c),
        destroy: plugin.destroyClient ? (c) => plugin.destroyClient!(c) : undefined,
        cacheKey: plugin.cacheKey,
      })
    }
    if (!plugin.session) return pool.getOrCreate<T>(plugin.name, resolved.credentials)
    // A live pooled client wins over the on-disk session: putting a restored
    // client over it would dispose (and log out) the one already in use.
    const pooled = pool.get<T>(plugin.name, resolved.credentials)
    if (pooled) return pooled

    // Session cache: restore without logging in when a fresh entry exists;
    // otherwise log in through the pool and save what the provider marks
    // reusable. Standalone only: embedded hosts keep a warm pool instead.
    const key = instanceKey(plugin.name, resolved.credentials)
    const cache = new FileSessionCache(this.config.cacheDir)
    const entry = await cache.load(plugin.name, key)
    if (entry && !isExpired(entry)) {
      try {
        const restored = await plugin.session.restore(resolved.credentials, entry)
        pool.put(plugin.name, resolved.credentials, restored)
        return restored as T
      } catch {
        await cache.clear(plugin.name, key)
      }
    }
    const client = await pool.getOrCreate<T>(plugin.name, resolved.credentials)
    const snapshot = plugin.session.save(client)
    if (snapshot) await cache.save(plugin.name, key, snapshot)
    return client
  }

  /**
   * Drop the cached session for this instance when a provider error says
   * the session is dead, so the next run logs in instead of failing again.
   */
  protected invalidateSessionOnAuthError(error: unknown): void {
    const plugin = (this.constructor as typeof AciBaseCommand).provider
    if (this.invocation || !plugin?.session || !this.resolvedCredentials) return
    const cls = classifyError(error instanceof Error ? error : String(error))
    if (cls === 'auth_failed' || cls === 'auth_required') {
      new FileSessionCache(this.config.cacheDir).clearSync(plugin.name, instanceKey(plugin.name, this.resolvedCredentials))
    }
  }

  // --- Tenant catalogue ---

  /** The instance key for the credentials getClient() resolved, or undefined before that. */
  protected currentInstanceKey(): string | undefined {
    const plugin = (this.constructor as typeof AciBaseCommand).provider
    return plugin && this.resolvedCredentials ? instanceKey(plugin.name, this.resolvedCredentials) : undefined
  }

  /** The host's TenantCache when embedded, the file cache under cacheDir standalone. */
  protected tenantCache(): TenantCache {
    return this.invocation?.tenantCache ?? new FileTenantCache(this.config.cacheDir, (m) => this.warn(m))
  }

  /**
   * Handle --bootstrap / --refresh for an introspect command whose provider
   * offers a tenant walk. Returns true when it handled the invocation (the
   * caller returns). Prints a summary, never the catalogue itself.
   */
  protected async handleTenantFlags(flags: Record<string, unknown>, client: unknown): Promise<boolean> {
    if (!flags.bootstrap && !flags.refresh) return false
    const plugin = (this.constructor as typeof AciBaseCommand).provider
    if (!plugin?.tenant) {
      this.outputError({code: 'NO_TENANT_WALK', message: `${plugin?.displayName ?? 'This provider'} has no tenant walk`})
      this.exit(2)
    }
    const key = this.currentInstanceKey()
    if (!key) throw new Error('handleTenantFlags called before getClient()')
    const cache = this.tenantCache()
    let catalog = flags.refresh ? undefined : await cache.load(plugin.name, key)
    const cached = Boolean(catalog)
    if (!catalog) {
      catalog = await plugin.tenant.buildCatalog(client, {all: Boolean(flags.all)})
      await cache.save(plugin.name, key, catalog)
    }
    await this.outputResult({
      provider: plugin.name,
      instanceKey: key,
      capturedAt: catalog.capturedAt,
      cached,
      entities: catalog.entities.length,
      customEntities: catalog.entities.filter((e) => e.custom).length,
      entityNames: catalog.entities.map((e) => e.name),
    })
    return true
  }

  // --- Canonical names ---

  /** The host's AliasStore when embedded, config.yaml plus the starter vocabulary standalone. */
  protected aliasStore(): AliasStore {
    return this.invocation?.aliasStore ?? new FileAliasStore(this.config.configDir, (m) => this.warn(m))
  }

  /** The instance alias for mappings: --instance, else the profile name, else any. */
  protected currentInstanceAlias(flags: Record<string, unknown>): string {
    return (flags.instance as string | undefined) ?? getCommandContext(this.config)?.profile ?? '*'
  }

  /**
   * Resolve a canonical entity (and optionally canonical field names) to
   * native names for this command's provider and the current instance. An
   * unknown name is exit 2 with the nearest canonical names listed.
   */
  protected async resolveCanonical(
    flags: Record<string, unknown>,
    entity: string,
    fields?: string[],
  ): Promise<{entity: string; fields?: string[]; toNative: Record<string, string>; toCanonical: Record<string, string>; context: NonNullable<ResponseContext['canonical']>}> {
    const plugin = (this.constructor as typeof AciBaseCommand).provider
    if (!plugin) throw new Error('resolveCanonical needs a provider command')
    const instance = this.currentInstanceAlias(flags)
    const store = this.aliasStore()
    const resolved = await store.resolveEntity(entity, plugin.name, instance)
    if (!resolved) {
      const near = nearestCanonical(await store.sets(), entity)
      this.outputError({
        code: 'CANONICAL_NOT_FOUND',
        message: `No mapping for canonical '${entity}' on ${plugin.name}${instance === '*' ? '' : ` instance '${instance}'`}`,
        ...(near.length ? {syntaxGuide: `Nearest canonical names: ${near.join(', ')}`} : {}),
        workingExample: `$BIN aliases resolve ${entity} --provider ${plugin.name} --json`,
      })
      this.exit(2)
    }
    const mapped = fields?.map((f) => {
      const native = resolved.fieldMap[f]
      if (!native) {
        this.outputError({
          code: 'CANONICAL_FIELD_NOT_FOUND',
          message: `Canonical '${entity}' has no field '${f}' on ${plugin.name}`,
          syntaxGuide: `Known canonical fields: ${Object.keys(resolved.fieldMap).join(', ') || '(none)'}`,
        })
        this.exit(2)
      }
      return native
    })
    return {
      entity: resolved.native,
      fields: mapped,
      toNative: resolved.fieldMap,
      toCanonical: invert(resolved.fieldMap),
      context: {set: resolved.set, entity, native: resolved.native, instance},
    }
  }

  /**
   * The cached catalogue for the instance the environment's credentials
   * point at, if any. Used by introspection consumers (learn, --schema),
   * which run before flags are parsed and must not touch the network.
   */
  protected async tenantCatalogFromEnv(): Promise<TenantCatalog | undefined> {
    const plugin = (this.constructor as typeof AciBaseCommand).provider
    if (!plugin) return undefined
    const resolved = credentialsFromSchema(plugin.credentials, valuesFromEnv(plugin.credentials, process.env))
    if (!resolved) return undefined
    return this.tenantCache().load(plugin.name, instanceKey(plugin.name, resolved.credentials))
  }

  /**
   * Emit the structured "no credentials" error and exit 3. `paths` lists
   * the accepted ways to authenticate, one per line, so an agent can pick
   * one without reading provider docs.
   */
  protected noCredentialsError(providerDisplayName: string, paths: string[]): never {
    this.outputError({
      code: 'NO_CREDENTIALS',
      message: `No ${providerDisplayName} credentials provided.`,
      syntaxGuide: ['Use one of:', ...paths.map((p) => `  ${p}`)].join('\n'),
    })
    this.exit(3)
  }

  // --- Error Formatting ---

  /**
   * Format an API error into a structured ACI error with recovery hints.
   *
   * When the caller can supply the SOQL (or other query text) that produced
   * the error, pass it via ``context.query`` — we'll inspect it to refine
   * generic messages like ``INVALID_FIELD`` into the specific failure mode
   * that triggered it (e.g. the "ORDER BY <aggregate-alias>" trap that
   * Salesforce rejects but that looks from the error alone like an ordinary
   * missing-column error). Callers that don't have a query are fine passing
   * nothing; the old generic hints still apply.
   */
  protected formatError(error: unknown, context?: {query?: string}): AciError {
    if (isExitError(error)) throw error
    this.invalidateSessionOnAuthError(error)
    const provider = (this.constructor as typeof AciBaseCommand).provider
    if (provider?.classifyError) {
      const hinted = provider.classifyError(error, context)
      if (hinted) return hinted
    }
    if (error instanceof Error) {
      const aciError: AciError = {
        code: 'COMMAND_ERROR',
        message: error.message,
      }

      // Generic hints only; provider-specific ones come from plugin.classifyError.
      const msg = error.message.toLowerCase()
      if (/insufficient[ _]access|permission|\(403\)|forbidden/.test(msg)) {
        aciError.code = 'INSUFFICIENT_ACCESS'
        aciError.syntaxGuide = 'Check the account\'s permissions, or use --dry-run to preview'
      }

      return aciError
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
    }
  }

  // --- Response Building ---

  /**
   * Build response context block appended to every output.
   */
  protected buildContext(opts: {
    returned?: number
    total?: number | null
    hasMore?: boolean
    nextCommand?: string | null
    availableFields?: string[]
    refinements?: string[]
    relatedCommands?: string[]
  }): ResponseContext {
    return {
      contract: CONTRACT_VERSION,
      pagination: (opts.returned !== undefined) ? {
        returned: opts.returned,
        total: opts.total ?? null,
        hasMore: opts.hasMore ?? false,
        nextCommand: opts.nextCommand ?? null,
      } : null,
      rateLimit: null, // Populated from API response headers when available
      availableFields: opts.availableFields ?? [],
      refinements: opts.refinements ?? [],
      relatedCommands: opts.relatedCommands ?? [],
    }
  }

  /**
   * Output a successful result with _context metadata.
   * Applies --fields filtering and --truncate limiting.
   */
  protected async outputResult(data: unknown, context?: ResponseContext): Promise<void> {
    const {flags} = await this.parse(this.constructor as typeof AciBaseCommand)
    let result = data

    // Apply --fields filtering
    if (flags.fields) {
      result = this.applyFieldsFilter(result, flags.fields)
    }

    // Apply --truncate limiting
    if (flags.truncate !== undefined) {
      result = this.applyTruncate(result, flags.truncate)
    }

    // Mask sensitive fields unless --full
    if (!flags.full) {
      result = maskSensitiveFields(result)
    }

    const output: Record<string, unknown> = {
      success: true,
      result,
      _context: {contract: CONTRACT_VERSION, ...(context ?? this.buildContext({}))},
    }
    this.logOutput(output, flags.pretty)
  }

  /**
   * Output an error result.
   */
  /**
   * Report an error envelope. Standalone, the process exit code follows the
   * error (3 for authentication, 2 for usage, 1 otherwise) unless the
   * command exits explicitly afterwards; embedded, the runtime reads the
   * envelope and the host decides.
   */
  protected outputError(error: AciError): void {
    const output = {success: false, error}
    const isPretty = this.argv.includes('--pretty')
    this.logOutput(output, isPretty)
    if (!this.invocation) {
      const exitCode = exitCodeForError(error, classifyError)
      setCommandOutcome({exitCode, error})
      process.exitCode = exitCode
    }
  }

  /**
   * oclif parse failures (unknown flag, missing required flag or arg,
   * invalid option) become a JSON error envelope on stdout with exit 2, so
   * an agent never has to read help text. Everything else keeps oclif's
   * handling.
   */
  protected override async catch(err: Error & {oclif?: {exit?: number}; parse?: unknown}): Promise<unknown> {
    if (err.parse !== undefined && typeof err === 'object') {
      const commandId = ((this.constructor as unknown as {id?: string}).id || this.constructor.name).replace(/:/g, ' ')
      this.outputError({
        code: 'INVALID_USAGE',
        message: err.message.split('\n')[0],
        syntaxGuide: `Run $BIN ${commandId} --schema --json to list the flags and args this command accepts`,
      })
      throw new Errors.ExitError(2)
    }
    return super.catch(err)
  }

  /**
   * Log output as JSON or colored JSON depending on --pretty flag.
   */
  private logOutput(output: unknown, pretty?: boolean): void {
    if (pretty) {
      this.log(ux.colorizeJson(output, {pretty: true, theme: this.config.theme?.json ?? PRETTY_JSON_THEME}))
    } else {
      this.log(JSON.stringify(output, null, 2))
    }
  }

  /**
   * Check if dry-run mode is active. If so, output the preview and return true.
   */
  protected isDryRun(flags: Record<string, unknown>, preview: Record<string, unknown>): boolean {
    if (flags['dry-run']) {
      this.log(JSON.stringify({
        dryRun: true,
        wouldExecute: preview,
        aciMetadata: (this.constructor as typeof AciBaseCommand).aciMetadata,
      }, null, 2))
      return true
    }
    return false
  }

  // --- Private Helpers ---

  /**
   * Filter result to only include specified fields.
   */
  private applyFieldsFilter(data: unknown, fieldsStr: string): unknown {
    const fields = fieldsStr.split(',').map(f => f.trim())

    if (Array.isArray(data)) {
      return data.map(item => this.filterObject(item, fields))
    }

    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      // If the result has a 'records' array, filter those
      if (Array.isArray(obj.records)) {
        return {
          ...obj,
          records: obj.records.map((item: unknown) => this.filterObject(item, fields)),
        }
      }
      return this.filterObject(data, fields)
    }

    return data
  }

  private filterObject(obj: unknown, fields: string[]): unknown {
    if (!obj || typeof obj !== 'object') return obj
    const source = obj as Record<string, unknown>
    const filtered: Record<string, unknown> = {}
    for (const field of fields) {
      if (field in source) {
        filtered[field] = source[field]
      }
    }
    return filtered
  }

  /**
   * Truncate arrays in the result to the specified limit.
   */
  private applyTruncate(data: unknown, limit: number): unknown {
    if (Array.isArray(data)) {
      return data.slice(0, limit)
    }

    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      // If the result has a 'records' array, truncate that
      if (Array.isArray(obj.records)) {
        return {
          ...obj,
          records: obj.records.slice(0, limit),
          _truncated: obj.records.length > limit ? {original: obj.records.length, returned: limit} : undefined,
        }
      }
    }

    return data
  }
}

/**
 * Infer flag categories from flag names when no explicit categorization is provided.
 */
function inferFlagCategory(flagName: string): FlagCategory[] {
  const authFlags = ['identity-token', 'profile', 'instance-url', 'access-token', 'login-url',
    'sf-username', 'sf-password', 'security-token', 'client-id', 'client-secret',
    'sn-username', 'sn-password',
    'service-account-key', 'delegated-user',
    'gw-client-id', 'gw-client-secret', 'refresh-token',
    'developer-token', 'login-customer-id', 'li-version',
    'mt-username', 'mt-password']
  const outputFlags = ['json', 'fields', 'truncate', 'diff', 'shape', 'display-value',
    'exclude-reference-link']
  const filteringFlags = ['query', 'where', 'limit', 'table', 'object', 'sobject',
    'customer-id', 'account', 'accounts', 'status', 'pivot', 'metrics', 'segments',
    'date-range', 'start', 'end', 'granularity']
  const paginationFlags = ['limit', 'offset', 'order-by', 'page-size', 'page-token']
  const bulkFlags = ['values', 'external-id-field']

  const categories: FlagCategory[] = []
  if (authFlags.includes(flagName)) categories.push('auth')
  if (outputFlags.includes(flagName)) categories.push('output')
  if (filteringFlags.includes(flagName)) categories.push('filtering')
  if (paginationFlags.includes(flagName)) categories.push('pagination')
  if (bulkFlags.includes(flagName)) categories.push('bulk')

  return categories
}
