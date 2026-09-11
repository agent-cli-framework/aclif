export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Release automation reads these types; see scripts/release-version.mjs.
    'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore', 'ci', 'build', 'style', 'revert', 'deps']],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'header-max-length': [2, 'always', 100],
    // Subjects name providers (Salesforce, DocuSign) and keep their casing.
    'subject-case': [0],
  },
}
