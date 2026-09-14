// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * oclif's explicit command catalog for the framework's own reference
 * binary (package.json oclif.commands.target). It is one CLI built with
 * defineCli(), exactly as a downstream CLI would be, with every built-in
 * provider in its tier.
 */
import {createRequire} from 'node:module'

import {defineCli} from './cli/define-cli.js'
import {PROVIDER_ENTRIES} from './providers/index.js'

const pkg = createRequire(import.meta.url)('../package.json') as {oclif: {bin: string; dirname: string}}

export const {COMMANDS, registry} = defineCli({bin: pkg.oclif.bin, dirname: pkg.oclif.dirname, providers: PROVIDER_ENTRIES})
