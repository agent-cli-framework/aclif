#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
// Scaffold a CLI package built on aclif, the way `oclif generate` scaffolds an oclif CLI.
//
//   npx --package @aclif/core aclif-scaffold-cli --name mycli --dir ../mycli [--providers salesforce,servicenow] [--aclif npm:@aclif/core@^1.0.0]
//
// Writes a complete package: package.json with the oclif block pointing at
// the CLI's own command target and hooks, bin/run.js, src/index.ts calling
// defineCli(), hook re-exports, a topic generator, and a README. Build it
// with `npm install && npm run build`, then run `./bin/run.js discover`.
import {chmodSync, existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length))
const name = args.name
if (!/^[a-z][a-z0-9-]*$/.test(name ?? '')) {
  console.error('usage: aclif-scaffold-cli --name <bin> [--dir <path>] [--providers a,b] [--aclif <version-or-path>]')
  process.exit(2)
}
const dir = resolve(args.dir ?? name)
if (existsSync(join(dir, 'package.json'))) {
  console.error(`${dir} already has a package.json`)
  process.exit(1)
}
const providers = (args.providers ?? 'salesforce,servicenow,docusign,agentforce').split(',').map((s) => s.trim()).filter(Boolean)
const aclifSpec = args.aclif ?? 'npm:@aclif/core@^1.0.0'
const sym = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Plugin'
const Scope = name.replace(/-/g, '_').toUpperCase()

const files = {
  'package.json': JSON.stringify({
    name,
    version: '0.1.0',
    description: `${name}: a command-line interface for agents, built on aclif`,
    type: 'module',
    license: 'MIT',
    bin: {[name]: 'bin/run.js'},
    main: 'lib/index.js',
    types: 'lib/index.d.ts',
    files: ['/bin', '/lib', '/oclif.manifest.json'],
    engines: {node: '>=22.0.0'},
    scripts: {
      build: 'tsc -b && node scripts/gen-topics.mjs',
      prepack: 'npm run build && oclif manifest',
      postpack: 'node -e "require(\'fs\').rmSync(\'oclif.manifest.json\',{force:true})"',
      test: 'vitest run',
    },
    dependencies: {aclif: aclifSpec, '@oclif/core': '^4.2.0', '@oclif/plugin-help': '^6.2.0', '@oclif/plugin-plugins': '^5.4.0'},
    devDependencies: {'@types/node': '^22.0.0', ajv: '^8.12.0', msw: '^2.0.0', oclif: '^4.17.0', typescript: '^5.7.0', vitest: '^5.0.0'},
    oclif: {
      bin: name,
      dirname: name,
      commands: {strategy: 'explicit', target: './lib/index.js', identifier: 'COMMANDS'},
      topicSeparator: ' ',
      plugins: ['@oclif/plugin-help', '@oclif/plugin-plugins'],
      hooks: {init: './lib/hooks/init', prerun: './lib/hooks/prerun', finally: './lib/hooks/finally'},
      topics: {},
    },
  }, null, 2) + '\n',
  'tsconfig.json': JSON.stringify({
    compilerOptions: {declaration: true, module: 'Node16', moduleResolution: 'Node16', outDir: './lib', rootDir: './src', strict: true, target: 'ES2022', esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true},
    include: ['src/**/*'],
  }, null, 2) + '\n',
  '.gitignore': 'node_modules/\n/lib/\ntsconfig.tsbuildinfo\noclif.manifest.json\n',
  'bin/run.js': "#!/usr/bin/env node\n\nimport {execute} from '@oclif/core'\n\nawait execute({dir: import.meta.url})\n",
  'src/index.ts': `/**
 * ${name}: the oclif command target for this CLI.
 * Pick the providers this CLI ships; add your own under src/providers/.
 */
import {defineCli, type DefinedCli} from 'aclif'
import {${providers.map(sym).join(', ')}} from 'aclif/providers'

// Annotated so the emitted declaration names types through 'aclif' only. With a
// file: dependency the framework carries its own @oclif/core copy, and an inferred
// type would point into that path (TS2742).
const cli: DefinedCli = defineCli({
  bin: '${name}',
  providers: [${providers.map(sym).join(', ')}],
})
export const COMMANDS: DefinedCli['COMMANDS'] = cli.COMMANDS
export const registry: DefinedCli['registry'] = cli.registry
`,
  'src/hooks/init.ts': "export {default} from 'aclif/hooks/init'\n",
  'src/hooks/prerun.ts': "export {default} from 'aclif/hooks/prerun'\n",
  'src/hooks/finally.ts': "export {default} from 'aclif/hooks/finally'\n",
  'src/providers/dependency-allowlist.json': '{\n  "packages": {}\n}\n',
  'vitest.config.ts': "import {defineConfig} from 'vitest/config'\n\nexport default defineConfig({\n  test: {\n    include: ['test/**/*.test.ts'],\n    // oclif captures stdout/stderr itself; vitest's interception breaks that.\n    disableConsoleIntercept: true,\n    testTimeout: 30_000,\n    hookTimeout: 30_000,\n  },\n})\n",
  'test/conformance.test.ts': `/**
 * The framework's conformance suite over this CLI's own providers (the
 * directories under src/providers). Providers imported from aclif are
 * checked upstream. Every rule id is documented in the framework's
 * docs/PROVIDER_AUTHORING.md. Run with \`npm test\` after \`npm run build\`.
 */
import {conformanceSuite} from 'aclif/testing'

import {registry} from '../src/index.js'

conformanceSuite({
  registry,
  cliRoot: process.cwd(),
  sourceDirs: [{dir: 'src/providers', tier: 'private'}],
  dependencyAllowlist: 'src/providers/dependency-allowlist.json',
})
`,
  'src/providers/README.md': `# ${name} providers\n\nProviders that belong to this CLI. Scaffold one with the framework's provider layout (see aclif's docs/PROVIDER_AUTHORING.md), import its plugin in src/index.ts, and add it to the providers list.\n`,
  'scripts/gen-topics.mjs': `// Emit the oclif topic table into package.json from this CLI's registry. Runs after build.
import {readFileSync, writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

const CORE_TOPICS = {
  discover: {description: 'List all available providers, topics, and commands'},
  learn: {description: 'Compact agent briefing for a provider'},
  manifests: {description: 'Validate and list declarative command manifests'},
  aliases: {description: 'Canonical entity and field names across providers'},
  auth: {description: 'Identity, profile, and cached sessions'},
}
const {registry} = await import(pathToFileURL('lib/index.js').href)
const topics = {...CORE_TOPICS}
for (const {plugin} of registry.entries()) {
  topics[plugin.name] = {description: plugin.description}
  for (const [topic, meta] of Object.entries(plugin.metadata.topics ?? {})) topics[\`\${plugin.name}:\${topic}\`] = {description: meta.description}
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const sorted = Object.fromEntries(Object.keys(topics).sort().map((k) => [k, topics[k]]))
if (JSON.stringify(pkg.oclif.topics) !== JSON.stringify(sorted)) {
  pkg.oclif.topics = sorted
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n')
}
`,
  'README.md': `# ${name}

A command-line interface for agents, built on [aclif](https://github.com/agent-cli-framework/aclif).

\`\`\`bash
npm install && npm run build
./bin/run.js discover --json
./bin/run.js learn salesforce --json
\`\`\`

Configuration lives in the ${name} config directory (\`~/.config/${name}/config.yaml\` on Linux). Framework variables are scoped to this CLI: \`${Scope}_PROFILE\`, \`${Scope}_INSTANCE\`, \`${Scope}_IDENTITY_TOKEN\`, \`${Scope}_IDENTITY_SECRET\`, \`${Scope}_NO_MANIFESTS\`.

Providers: ${providers.join(', ')} from aclif. Add this CLI's own under \`src/providers/\` and list them in \`src/index.ts\`.
`,
}
for (const [rel, content] of Object.entries(files)) {
  const path = join(dir, rel)
  mkdirSync(join(path, '..'), {recursive: true})
  writeFileSync(path, content)
  if (rel.startsWith('bin/')) chmodSync(path, 0o755)
}
console.log(`scaffolded ${name} in ${dir}\n  cd ${dir} && npm install && npm run build && ./bin/run.js discover --json`)
