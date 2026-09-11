// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * SIGINT handler for aclif.
 *
 * When a mutation command is interrupted, writes a JSON warning to stderr
 * so the gateway/agent knows the operation may have partially completed.
 * Exits with code 130 (128 + SIGINT signal 2).
 */

let currentOperation: {command: string; mutability: string} | null = null

export function registerOperation(command: string, mutability: string): void {
  currentOperation = {command, mutability}
}

export function clearOperation(): void {
  currentOperation = null
}

export function installSigintHandler(): void {
  process.on('SIGINT', () => {
    if (currentOperation && currentOperation.mutability !== 'read') {
      process.stderr.write(JSON.stringify({
        warning: 'SIGINT received during mutation operation',
        command: currentOperation.command,
        mutability: currentOperation.mutability,
        note: 'The operation may have partially completed. Check the target system for partial results.',
      }) + '\n')
    }

    process.exit(130)
  })
}
