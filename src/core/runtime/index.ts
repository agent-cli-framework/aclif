// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Public exports for the embedded aclif runtime.
 *
 * Hosts (the gateway) import from here. The standalone CLI binary
 * (bin/run.js) does NOT use these — it uses oclif's normal execute() flow.
 */

export {Runtime, type RunResult, type RuntimeOptions} from './runtime.js'
export {ConnectionPool, type PoolStats, type ConnectionFactory, type ConnectionPoolOptions} from './connection-pool.js'
export {
  StdoutReporter,
  EventReporter,
  type Reporter,
  type ReporterEvent,
  type CommandEnvelope,
  type AuditEvent,
  type LogLevel,
} from '../output/reporter.js'
export {
  ChainCredentialResolver,
  EnvCredentialResolver,
  ProfileCredentialResolver,
  StaticCredentialResolver,
  type CredentialResolver,
} from './credential-resolver.js'
export {getProcessPool, resetProcessPool} from './process-pool.js'
export {
  type Invocation,
  type ExecutionContext,
  type InvocationHooks,
  type CapabilityGateInput,
  type GateDecision,
} from './invocation.js'
export {AciRuntimeError, exitCodeToCategory, isAciRuntimeError} from '../errors/runtime-error.js'
export {
  HealthMonitor,
  type HealthMonitorOptions,
  type HealthSnapshot,
  type HealthStatus,
} from './health-monitor.js'
export {ProbeTimer, type ProbeConfig} from './probe-timer.js'
export {classifyError, errorClassDescription, type ErrorClass} from '../errors/classifier.js'
