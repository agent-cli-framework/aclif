// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * The framework's built-in providers, generated from the directories
 * present under native/, contributed/, and private/ by
 * scripts/gen-provider-index.mjs (postinstall and prebuild). A CLI built
 * on the framework picks from these (and adds its own) in defineCli();
 * importing this module also registers them as the fallback registry for
 * code that runs without a CLI. See docs/FORKING.md.
 */
import {ProviderRegistry, registerFallbackRegistry} from '../core/provider/registry.js'
import {PROVIDER_ENTRIES} from './index.generated.js'

export * from './index.generated.js'
export {getRegistry} from '../core/provider/registry.js'

let builtin: ProviderRegistry | undefined
/** The framework's own providers as a registry, independent of any defined CLI. */
export function builtinRegistry(): ProviderRegistry {
  if (!builtin) builtin = new ProviderRegistry(PROVIDER_ENTRIES)
  return builtin
}

registerFallbackRegistry(builtinRegistry)
