// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
// Emit the oclif topic table into package.json from the built registry:
// one topic per provider (its description) and one per provider topic
// (from plugin.metadata.topics), plus the core topics. Runs after build so
// it can import lib/. Idempotent: rewrites package.json only on change.
import {readFileSync, writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

const CORE_TOPICS = {
  discover: {description: 'List all available providers, topics, and commands'},
  learn: {description: 'Compact agent briefing for a provider'},
  manifests: {description: 'Validate and list declarative command manifests'},
  aliases: {description: 'Canonical entity and field names across providers'},
  auth: {description: 'Identity, profile, and cached sessions'},
}

const {builtinRegistry} = await import(pathToFileURL('lib/providers/index.js').href)
const topics = {...CORE_TOPICS}
for (const {plugin} of builtinRegistry().entries()) {
  topics[plugin.name] = {description: plugin.description}
  for (const [topic, meta] of Object.entries(plugin.metadata.topics ?? {})) {
    topics[`${plugin.name}:${topic}`] = {description: meta.description}
  }
}
const sorted = Object.fromEntries(Object.keys(topics).sort().map((k) => [k, topics[k]]))

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const before = JSON.stringify(pkg.oclif.topics)
pkg.oclif.topics = sorted
if (before !== JSON.stringify(sorted)) {
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
  console.log(`gen-topics: ${Object.keys(sorted).length} topics written to package.json`)
}
