// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Environment variable names scoped to the CLI's bin, the way oclif scopes
 * <BIN>_CONFIG_DIR. The framework reads its own ACLIF_* names internally
 * (flag env bindings are static); a CLI named mycli exposes MYCLI_PROFILE,
 * MYCLI_IDENTITY_TOKEN, and so on, and applyScopedEnv() maps those onto
 * the framework names once per process, before anything reads them.
 */
export const FRAMEWORK_PREFIX = 'ACLIF'
export const SCOPED_SUFFIXES = ['PROFILE', 'INSTANCE', 'IDENTITY_TOKEN', 'IDENTITY_SECRET', 'NO_MANIFESTS'] as const

export function envScope(bin: string): string {
  return bin.replace(/-/g, '_').toUpperCase()
}

/** The scoped name a CLI's users see for a framework variable, e.g. MYCLI_PROFILE. */
export function scopedEnvName(bin: string, suffix: (typeof SCOPED_SUFFIXES)[number]): string {
  return `${envScope(bin)}_${suffix}`
}

/** Copy <SCOPE>_X onto ACLIF_X where the former is set and the latter is not. Idempotent. */
export function applyScopedEnv(bin: string, env: NodeJS.ProcessEnv = process.env): void {
  const scope = envScope(bin)
  if (scope === FRAMEWORK_PREFIX) return
  for (const suffix of SCOPED_SUFFIXES) {
    const scoped = env[`${scope}_${suffix}`]
    const framework = `${FRAMEWORK_PREFIX}_${suffix}`
    if (scoped !== undefined && env[framework] === undefined) env[framework] = scoped
  }
}
