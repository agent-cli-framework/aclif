import js from '@eslint/js'
import importX from 'eslint-plugin-import-x'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Layout boundaries (conformance rule C-TIER-1). The zones name the tiered
 * provider layout and are inert until those directories exist. Cross-provider imports
 * inside one tier cannot be expressed as static zones; the conformance
 * suite covers that case.
 */
const providerTiers = ['native', 'contributed', 'private']
const boundaryZones = [
  ...['./src/core', './src/cli'].map((target) => ({
    target,
    from: './src/providers',
    except: ['./index.ts', './index.generated.ts'],
    message: 'core and cli import providers only through src/providers/index.ts',
  })),
  ...providerTiers.flatMap((a) =>
    providerTiers
      .filter((b) => b !== a)
      .map((b) => ({
        target: `./src/providers/${a}`,
        from: `./src/providers/${b}`,
        message: 'a provider never imports another provider directory',
      })),
  ),
]

export default tseslint.config(
  {ignores: ['lib/**', 'node_modules/**', 'test/contract/golden/**', 'oclif.manifest.json']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    plugins: {'import-x': importX},
    languageOptions: {globals: {...globals.node}},
    rules: {
      'import-x/no-restricted-paths': ['error', {zones: boundaryZones}],
      // Warnings rather than errors while the remaining occurrences are cleared;
      // promote to errors once the tree is clean.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'prefer-const': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
)
