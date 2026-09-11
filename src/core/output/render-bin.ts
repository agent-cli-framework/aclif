// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Command strings in examples, hints, and next-command suggestions are
 * authored with the $BIN token and rendered with the configured binary
 * name at emit time, so a distribution with another bin name (or an
 * embedding host) never prints a name it does not answer to.
 */
export const BIN_TOKEN = '$BIN'

export function renderBin(text: string, bin: string): string {
  return text.includes(BIN_TOKEN) ? text.split(BIN_TOKEN).join(bin) : text
}
