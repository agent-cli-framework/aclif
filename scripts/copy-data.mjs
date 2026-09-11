// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
// Copy static data files tsc does not emit (JSON fixtures under src/data) into lib/.
import {cpSync, existsSync} from 'node:fs'
if (existsSync('src/data')) cpSync('src/data', 'lib/data', {recursive: true})
