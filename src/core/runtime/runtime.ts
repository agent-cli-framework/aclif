// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Runtime: the embedded aclif execution host.
 *
 * The Runtime owns the oclif Config (loaded once at startup), the connection
 * pool, and the dispatch logic. It exposes one entry point — run(invocation)
 * — that finds the command class for an argv, instantiates it, attaches the
 * Invocation, and calls run().
 *
 * The standalone CLI binary (bin/run.js) does NOT use this Runtime; it uses
 * oclif's normal execute() flow with EnvCredentialResolver and StdoutReporter
 * supplied by the base command's adapter logic. That keeps the binary's
 * behavior identical to before.
 *
 * The gateway uses Runtime.run() with EventReporter and a vault-backed
 * CredentialResolver to drive the same command classes inside its own process.
 */

import {Config} from '@oclif/core'
import {dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

import type {Invocation} from './invocation.js'
import {ConnectionPool} from './connection-pool.js'
import type {ProviderRegistry} from '../provider/registry.js'
import {manifestCommand} from '../manifest/manifest-command.js'
import type {CommandManifest} from '../manifest/manifest.js'
import {renderBin} from '../output/render-bin.js'
import {getRegistry} from '../provider/registry.js'
import {AciRuntimeError, exitCodeToCategory, isAciRuntimeError} from '../errors/runtime-error.js'
import type {AciError} from '../contract/aci.js'
import type {CommandEnvelope} from '../output/reporter.js'
import {EventReporter} from '../output/reporter.js'
import {HealthMonitor, type HealthMonitorOptions} from './health-monitor.js'
import {ProbeTimer} from './probe-timer.js'

/** Result of a runtime.run() call */
export interface RunResult {
  /** True if the command produced a result envelope without throwing */
  success: boolean
  /** Exit code (0 = success, 2 = invalid usage, 3 = auth failure, other = api error) */
  exitCode: number
  /** Error category derived from exit code */
  errorCategory?: 'invalid_usage' | 'auth_failure' | 'api_error'
  /** The command envelope (success/result or success/error), built from the invocation's reporter */
  envelope: CommandEnvelope
}

export interface RuntimeOptions {
  /**
   * Path to the aclif package root (the directory containing package.json).
   * Defaults to the directory two levels above this file's compiled location
   * (lib/runtime/runtime.js → package root).
   */
  cliRoot?: string

  /** Connection pool tuning */
  pool?: {max?: number; ttl?: number}

  /** Provider registry; defaults to the build's registry. */
  registry?: ProviderRegistry

  /** Health monitor tuning */
  health?: HealthMonitorOptions
}

export class Runtime {
  readonly pool: ConnectionPool
  readonly healthMonitor: HealthMonitor
  readonly probeTimer: ProbeTimer
  readonly registry: ProviderRegistry
  /** Commands synthesised from manifests the host supplied; resolved alongside the oclif catalogue. */
  private manifestCommands: import('@oclif/core').Command.Loadable[] = []
  private oclifConfig: Config | null = null
  private cliRoot: string

  private constructor(opts: RuntimeOptions = {}) {
    this.pool = new ConnectionPool(opts.pool ?? {})
    this.healthMonitor = new HealthMonitor(opts.health ?? {})
    this.probeTimer = new ProbeTimer(this)

    this.cliRoot = opts.cliRoot ?? Runtime.defaultCliRoot()

    // Register every provider from the registry: a connection factory for
    // the pool and a health-monitor entry so hosts see each provider in
    // 'unknown' state before any traffic flows.
    this.registry = opts.registry ?? getRegistry()
    for (const {plugin} of this.registry.entries()) {
      this.pool.registerFactory(plugin.name, {
        create: (creds) => plugin.createClient(creds),
        destroy: plugin.destroyClient ? (c) => plugin.destroyClient!(c) : undefined,
        cacheKey: plugin.cacheKey,
      })
      this.healthMonitor.register(plugin.name)
    }
  }

  /**
   * Register manifest commands for a provider. Ids must not collide with
   * catalogue commands; a manifest that fails validation throws.
   */
  addManifestCommands(provider: string, manifests: CommandManifest[]): string[] {
    const plugin = this.registry.plugin(provider)
    if (!plugin) throw new Error(`Unknown provider '${provider}'`)
    const added: string[] = []
    for (const m of manifests) {
      if (this.registry.ownerOf(m.id) || this.manifestCommands.some((c) => c.id === m.id)) {
        throw new Error(`Manifest id '${m.id}' collides with an existing command`)
      }
      const cls = manifestCommand(m, plugin)
      this.manifestCommands.push({
        id: m.id,
        description: m.description,
        hidden: false,
        aliases: [],
        flags: {},
        args: {},
        pluginType: 'core',
        pluginName: 'manifest',
        aciMetadata: m.aciMetadata,
        load: async () => cls,
      } as unknown as import('@oclif/core').Command.Loadable)
      added.push(m.id)
    }
    return added
  }

  /** Default probe argv per provider, from each plugin's healthProbe. Hosts pass these to the ProbeTimer. */
  probeDefaults(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const {plugin} of this.registry.entries()) if (plugin.healthProbe) out[plugin.name] = [...plugin.healthProbe]
    return out
  }

  /**
   * Construct and initialize a Runtime. Loads the oclif Config once.
   */
  static async start(opts: RuntimeOptions = {}): Promise<Runtime> {
    // Load the oclif Config first: importing the CLI's command target runs
    // defineCli(), which makes that CLI's registry the active one.
    const cliRoot = opts.cliRoot ?? Runtime.defaultCliRoot()
    const config = await Config.load(cliRoot)
    const runtime = new Runtime({...opts, cliRoot})
    runtime.oclifConfig = config
    return runtime
  }

  private static defaultCliRoot(): string {
    const here = dirname(fileURLToPath(import.meta.url))
    return dirname(dirname(dirname(here)))
  }

  /**
   * Stop background tasks (probe timers). Called by the host on shutdown.
   */
  stop(): void {
    this.probeTimer.stop()
  }

  /**
   * Get the loaded oclif Config (for catalog inspection, etc.).
   */
  get config(): Config {
    if (!this.oclifConfig) {
      throw new Error('Runtime not started — call Runtime.start() first')
    }
    return this.oclifConfig
  }

  /**
   * Execute a ACI command described by an Invocation.
   *
   * Steps:
   *   1. Strip the leading bin name if present
   *   2. Find the command in the oclif catalog
   *   3. Resolve the command class (load it from disk if needed)
   *   4. Instantiate the command with the remaining argv
   *   5. Attach the invocation (stores it as `cmd.invocation`, overrides `log`/`exit`)
   *   6. Run the command's standard oclif lifecycle (init → run → finally)
   *   7. Catch AciRuntimeError and translate it into the result envelope
   *
   * Returns a RunResult that includes the standard CLI envelope so callers
   * can return it directly as their HTTP response body.
   */
  async run(invocation: Invocation): Promise<RunResult> {
    const startedAt = Date.now()
    const result = await this.runInner(invocation)
    const latencyMs = Date.now() - startedAt

    // Record health for the provider this command targeted. The provider is
    // derived from the first non-flag token of the original argv. If we can't
    // determine a provider (e.g. the discover/help commands), no health
    // recording happens.
    const provider = this.detectProvider(invocation.argv)
    if (provider) {
      // Trust the envelope's success flag, not just the exit code. Commands
      // commonly catch a provider error, write {success:false, error} to the
      // envelope via outputError(), and return normally — leaving exitCode=0.
      // Without this, transport-level failures like ServiceNow hibernation
      // get recorded as successes and the health badge stays green.
      const succeeded = result.success && result.envelope.success !== false
      if (succeeded) {
        this.healthMonitor.recordSuccess(provider, latencyMs)
      } else {
        const err = result.envelope.error
        this.healthMonitor.recordFailure(provider, {
          code: err?.code || 'COMMAND_ERROR',
          message: err?.message || `Command failed with exit ${result.exitCode}`,
        })
      }
    }

    return result
  }

  /**
   * Inner run() — does the actual command dispatch. Wrapped by run() with
   * health recording.
   */
  private async runInner(invocation: Invocation): Promise<RunResult> {
    if (!this.oclifConfig) {
      throw new Error('Runtime not started — call Runtime.start() first')
    }

    // Strip the leading bin name if the host included it
    let argv = invocation.argv
    if (argv[0] === this.oclifConfig.bin) argv = argv.slice(1)

    // Always run with --json (commands always emit structured output)
    if (!argv.includes('--json')) argv = [...argv, '--json']

    // Resolve the command id by walking the argv against the oclif catalog
    const resolved = this.resolveCommand(argv)
    if (!resolved) {
      const err: AciError = {
        code: 'COMMAND_NOT_FOUND',
        message: `Unknown command: ${argv.join(' ')}`,
        syntaxGuide: 'Use --discover to list available commands',
      }
      invocation.reporter.error(err)
      return this.buildResult(invocation, 2, err)
    }

    const {commandInfo, commandArgv} = resolved

    // Capability gate (if provided) — uses the manifest's aciMetadata, no need to load the class yet
    if (invocation.hooks?.capabilityGate) {
      const aciMetadata = (commandInfo as unknown as {aciMetadata?: import('../contract/aci.js').AciMetadata}).aciMetadata
      if (aciMetadata) {
        try {
          const decision = await invocation.hooks.capabilityGate(
            {
              commandId: commandInfo.id,
              aciMetadata,
              argv: commandArgv,
            },
            invocation.context,
          )
          if (!decision.allowed) {
            const err = decision.error || {
              code: 'CAPABILITY_DENIED',
              message: 'Operation denied by capability gate',
            }
            invocation.reporter.error(err)
            return this.buildResult(invocation, 3, err)
          }
        } catch (gateErr) {
          if (isAciRuntimeError(gateErr)) {
            invocation.reporter.error(gateErr.aciError)
            return this.buildResult(invocation, gateErr.exitCode, gateErr.aciError)
          }
          const err: AciError = {
            code: 'CAPABILITY_GATE_ERROR',
            message: gateErr instanceof Error ? gateErr.message : String(gateErr),
          }
          invocation.reporter.error(err)
          return this.buildResult(invocation, 1, err)
        }
      }
    }

    // Load the actual command class. oclif's Command.Loadable.load() resolves
    // the .ts/.js file and returns the constructor. The return type is
    // `typeof Command` (abstract) so we cast to a concrete constructor for
    // instantiation — every real ACI command extends AciBaseCommand which
    // is concrete.
    let commandClass: new (argv: string[], config: Config) => unknown
    try {
      const loaded = await commandInfo.load()
      commandClass = loaded as unknown as new (argv: string[], config: Config) => unknown
    } catch (loadErr) {
      const err: AciError = {
        code: 'COMMAND_LOAD_FAILED',
        message: loadErr instanceof Error ? loadErr.message : String(loadErr),
      }
      invocation.reporter.error(err)
      return this.buildResult(invocation, 1, err)
    }

    // Build the command instance and attach the invocation
    let exitCode = 0
    try {
      // oclif's Command.run is a static method that creates an instance
      // and runs the full lifecycle. We use the instance API instead so we
      // can attach the invocation BEFORE init/run are called.
      const cmd = new commandClass(commandArgv, this.oclifConfig) as InstanceWithInvocation

      // Attach invocation BEFORE init() so credential resolution and the
      // log/exit overrides are in place from the very first call.
      cmd.__invocation = invocation
      this.installInstanceOverrides(cmd, invocation)

      // Run oclif's standard lifecycle for an instance
      const cmdAny = cmd as unknown as {init: () => Promise<void>; run: () => Promise<unknown>}
      await cmdAny.init()
      await cmdAny.run()
    } catch (err) {
      if (isAciRuntimeError(err)) {
        exitCode = err.exitCode
        if (!invocation.reporter as unknown) {
          // Defensive: should always exist
        }
        // If the command didn't already report an error envelope, do so now.
        const evReporter = invocation.reporter as unknown as {hasOutput?: () => boolean}
        if (!evReporter.hasOutput || !evReporter.hasOutput()) {
          invocation.reporter.error(err.aciError)
        }
      } else if (this.isOclifExitError(err)) {
        exitCode = (err as {oclif?: {exit?: number}}).oclif?.exit ?? 0
        // Oclif throws an exit error on flag-validation failures
        // (e.g. unknown --flag, missing --required, bad enum). The
        // command never reaches outputResult/outputError, so the
        // reporter is empty. Without this, callers see HTTP 400 with
        // {success:true,_events:[]} — useless to the LLM. Surface
        // the underlying message + a stable code so the LLM can
        // correct itself on the next turn.
        if (exitCode !== 0) {
          const evReporter = invocation.reporter as unknown as {
            hasOutput?: () => boolean
          }
          if (!evReporter.hasOutput || !evReporter.hasOutput()) {
            const message = err instanceof Error ? err.message : String(err)
            invocation.reporter.error({
              code: 'COMMAND_INVOCATION_ERROR',
              message: message || `Command exited with code ${exitCode}`,
            })
          }
        }
      } else {
        exitCode = 1
        const aciError: AciError = {
          code: 'COMMAND_ERROR',
          message: err instanceof Error ? err.message : String(err),
        }
        const evReporter = invocation.reporter as unknown as {hasOutput?: () => boolean}
        if (!evReporter.hasOutput || !evReporter.hasOutput()) {
          invocation.reporter.error(aciError)
        }
      }
    }

    return this.buildResult(invocation, exitCode)
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /**
   * Detect the provider name (first non-flag token) from an argv. Returns
   * undefined for top-level commands like 'discover', 'learn', or 'help'
   * that don't target a specific provider.
   */
  private detectProvider(argv: string[]): string | undefined {
    const cleaned = argv[0] === this.oclifConfig?.bin ? argv.slice(1) : argv
    const first = cleaned.find((tok) => !tok.startsWith('-'))
    if (!first) return undefined
    // Top-level commands that aren't providers
    if (['discover', 'learn', 'help', 'plugins', 'version'].includes(first)) {
      return undefined
    }
    return first.toLowerCase()
  }

  /**
   * Walk argv against the oclif command tree to find the matching command.
   * aclif uses topicSeparator " ", so commands are like:
   *   ['salesforce','data','dml','insert','Account','--values','{...}']
   * The command id (oclif-internal) is 'salesforce:data:dml' and the
   * remaining argv is ['insert','Account','--values','{...}'].
   *
   * Returns the command's manifest entry (Command.Loadable). The caller
   * must invoke .load() to get the actual constructor.
   */
  private resolveCommand(argv: string[]): {commandInfo: import('@oclif/core').Command.Loadable; commandArgv: string[]} | null {
    if (!this.oclifConfig) return null

    let bestMatch: {info: import('@oclif/core').Command.Loadable; idLen: number} | null = null

    for (const cmd of [...this.oclifConfig.commands, ...this.manifestCommands]) {
      const idParts = cmd.id.split(':')
      if (idParts.length > argv.length) continue
      let match = true
      for (let i = 0; i < idParts.length; i++) {
        if (argv[i] !== idParts[i]) {
          match = false
          break
        }
      }
      if (match && (!bestMatch || idParts.length > bestMatch.idLen)) {
        bestMatch = {info: cmd, idLen: idParts.length}
      }
    }

    if (!bestMatch) return null

    return {
      commandInfo: bestMatch.info,
      commandArgv: argv.slice(bestMatch.idLen),
    }
  }

  /**
   * Per-instance overrides applied before init()/run().
   *
   * These reassign instance methods (NOT prototype methods) so two concurrent
   * commands writing to different reporters do not interfere with each other.
   *
   *   - this.log(msg)         → invocation.reporter as a debug log
   *   - this.logJson(obj)     → invocation.reporter.result(obj)
   *   - this.error(msg, opts) → throws AciRuntimeError instead of process.exit
   *   - this.exit(code)       → throws AciRuntimeError instead of process.exit
   */
  private installInstanceOverrides(cmd: InstanceWithInvocation, invocation: Invocation): void {
    const cmdAny = cmd as unknown as Record<string, unknown>

    // Override log() to forward through the reporter as raw output.
    //
    // Commands call this.log(JSON.stringify(envelope)) — we intercept that
    // string and route it to the appropriate reporter channel:
    //
    //   1. ACI envelope with success: true / false → reporter.result/error
    //   2. Any other parseable JSON object → reporter.result (covers
    //      introspection handlers like --schema, --examples, --discover that
    //      emit raw metadata objects rather than envelopes)
    //   3. Non-JSON strings → reporter.log('info', ...)
    //
    // This keeps existing command code working without modification.
    const bin = this.oclifConfig?.bin ?? 'aclif'
    cmdAny.log = ((message?: string | undefined) => {
      if (message === undefined) {
        return
      }
      const trimmed = renderBin(String(message), bin).trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>
          // ACI envelope with explicit success field
          if (parsed && typeof parsed === 'object' && 'success' in parsed) {
            const env = parsed as {
              success?: boolean
              result?: unknown
              error?: import('../contract/aci.js').AciError
              _context?: import('../contract/aci.js').ResponseContext
            }
            if (env.success === true) {
              invocation.reporter.result(env.result, env._context)
              return
            }
            if (env.success === false && env.error) {
              invocation.reporter.error(env.error)
              return
            }
          }
          // Plain object (introspection metadata, etc.) — route as result
          invocation.reporter.result(parsed)
          return
        } catch {
          // Not JSON — fall through to log
        }
      }
      // Fallback: treat as a free-form info log
      invocation.reporter.log('info', renderBin(String(message), bin))
    }) as typeof console.log

    // Override exit() to throw instead of calling process.exit
    cmdAny.exit = ((code?: number) => {
      throw new AciRuntimeError({
        error: {code: 'COMMAND_EXITED', message: `Command exited with code ${code ?? 0}`},
        exitCode: code ?? 0,
      })
    }) as (code?: number) => never

    // Override error() to throw instead of calling process.exit via oclif
    cmdAny.error = ((input: string | Error, opts?: {exit?: number; code?: string}) => {
      const message = renderBin(input instanceof Error ? input.message : String(input), bin)
      const code = opts?.code || 'COMMAND_ERROR'
      throw new AciRuntimeError({
        error: {code, message},
        exitCode: opts?.exit ?? 2,
      })
    }) as (input: string | Error, opts?: {exit?: number; code?: string}) => never
  }

  private buildResult(invocation: Invocation, exitCode: number, fallbackError?: AciError): RunResult {
    const reporter = invocation.reporter as unknown as EventReporter | {envelope?: () => CommandEnvelope}
    let envelope: CommandEnvelope
    if ('envelope' in reporter && typeof reporter.envelope === 'function') {
      envelope = reporter.envelope()
    } else if (fallbackError) {
      envelope = {success: false, error: fallbackError}
    } else {
      envelope = {success: exitCode === 0}
    }
    return {
      success: exitCode === 0,
      exitCode,
      errorCategory: exitCodeToCategory(exitCode),
      envelope,
    }
  }

  private isOclifExitError(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'oclif' in err)
  }
}

/**
 * Internal type alias: a command instance with our injected invocation.
 */
type InstanceWithInvocation = {__invocation?: Invocation}
