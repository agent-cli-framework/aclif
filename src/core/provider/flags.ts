// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags, type Interfaces} from '@oclif/core'

import {fieldKeys, type CredentialSchema} from './credential-schema.js'

/** oclif string flags generated from a credential schema, each bound to its env var. */
export function flagsFromSchema(schema: CredentialSchema): Record<string, Interfaces.OptionFlag<string | undefined>> {
  const out: Record<string, Interfaces.OptionFlag<string | undefined>> = {}
  for (const k of fieldKeys(schema)) {
    const f = schema.fields[k]!
    if (!f.flag) continue
    out[f.flag] = Flags.string({description: f.description, env: f.env, ...(f.default !== undefined ? {default: f.default} : {})})
  }
  return out
}
