// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * `aclif/testing`: what a CLI package built on the framework needs to test
 * the providers it declares. The conformance suite, golden capture, the
 * in-process and binary runners, the msw harness, and the schema
 * validators. Requires vitest, msw, and ajv as peer dependencies.
 */
export * from './conformance/index.js'
export {assertAciMetadata, assertEnvelope, SCHEMAS_DIR, tenantCatalogErrors, validateAciMetadata, validateEnvelope} from './envelope.js'
export {captureGoldens, goldenIds, goldenPath, INTROSPECTION_FLAGS, listCommandIds, NO_INTROSPECTION, normalize, readGolden, type CaptureOptions, type CaptureResult} from './golden.js'
export {providerHarness, type HarnessOptions, type ProviderHarness} from './harness.js'
export {html, http, HttpResponse, json as mswJson, settle, startServer, type SeenRequest} from './msw.js'
export {captureRun, cleanEnv, json, runBinary, runClass, runInProcess, scrubEnv, type RunOutput} from './run.js'
export {tokenize} from './tokenize.js'
