#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.

import {basename} from 'node:path'
import {execute} from '@oclif/core'

// oclif detects the shell while loading its config. On Windows, when SHELL is
// unset, it runs PowerShell and a WMI query synchronously on every command
// (@oclif/core 4.11.5 and later), which costs seconds per invocation. Nothing
// in aclif reads the result, so name the shell up front and skip the probe.
if (process.platform === 'win32' && !process.env.SHELL) {
  process.env.SHELL = basename(process.env.COMSPEC ?? 'cmd.exe')
}

await execute({dir: import.meta.url})
