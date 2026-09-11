// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * The standalone binary's ConnectionPool: one per process, created on first
 * use. Factories are registered by the base command from the plugin that
 * asks for a client, so this module needs no knowledge of the registry
 * (which would import every command class and cycle back into the base).
 * Embedded hosts never use this; they own their pool on the Invocation.
 */
import {ConnectionPool} from './connection-pool.js'

let pool: ConnectionPool | undefined

export function getProcessPool(): ConnectionPool {
  if (!pool) pool = new ConnectionPool()
  return pool
}

/** Test hook: drop the pool so the next call creates a fresh one. */
export function resetProcessPool(): void {
  pool = undefined
}
