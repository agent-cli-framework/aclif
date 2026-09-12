import {builtinRegistry} from '../../src/providers/index.js'
import {providerHarness as harness, json, type ProviderHarness, type RunOutput} from '../../src/testing/index.js'

export type {ProviderHarness}

/** The framework's provider harness: the built-in registry, this repository as the CLI root. */
export const providerHarness = (provider: string) => harness(provider, {registry: builtinRegistry(), cliRoot: process.cwd()})

export const parse = <T = Record<string, unknown>>(out: RunOutput): T => json<T>(out)
