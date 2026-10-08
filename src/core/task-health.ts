import { randomUUID } from 'node:crypto'

import { executeHealthCheck, inspectHealthCheck } from './health-check'

import type { HarnessDB } from './db'
import type { HarnessConfig, TaskExecutionMode } from '@/types'

/** Completion proof lives only fifteen minutes. This is deliberately evidence
 * of a recent command run, not a claim that source files stayed unchanged. */
export const HEALTH_EVIDENCE_TTL_MS = 15 * 60 * 1000

export interface TaskHealthResult {
  taskId: number
  state: 'passed' | 'failed' | 'missing' | 'placeholder' | 'incompatible'
  status: number | null
  tail: string
  logPath: string | null
  scriptPath: string
  startedAt: string
  completedAt: string
  expiresAt: string | null
  message?: string
  adaptFrom?: string
  /** Opaque server token used to bind a result to the active claim. */
  runId: string
  claimGeneration: number
  executionMode: TaskExecutionMode
}

/** Executes a health check on behalf of one task and persists only server-owned
 * metadata. A new `running` token invalidates any older pass before inspection
 * or spawning so failures and overlapping runs cannot resurrect stale proof. */
export async function runTaskHealthCheck(
  db: HarnessDB,
  cwd: string,
  config: HarnessConfig,
  taskId: number
): Promise<TaskHealthResult> {
  const task = await db.getTaskById(taskId)
  if (!task || task.archived_at) throw new Error(`Task not found: ${taskId}`)

  // ISO dates compare lexically. Move one millisecond past a just-recorded
  // claim so an immediate health.run is unambiguously post-claim too.
  const now = Date.now()
  const claimedAt = task.started_at ? Date.parse(task.started_at) + 1 : now
  const startedAt = new Date(Math.max(now, claimedAt)).toISOString()
  const token = randomUUID()
  const inspection = inspectHealthCheck(cwd, config.health.scriptPath)
  const claimGeneration = task.claim_generation
  const executionMode = task.execution_mode
  const reserved = await db.tasks.reserveHealthRun(taskId, token, startedAt, inspection.path, claimGeneration, executionMode)
  if (!reserved) throw new Error(`Task health run was superseded before it could start: ${taskId}`)

  const failed = async (
    state: Extract<TaskHealthResult['state'], 'missing' | 'placeholder' | 'incompatible' | 'failed'>,
    details: Pick<TaskHealthResult, 'tail' | 'logPath' | 'message' | 'adaptFrom'>
  ): Promise<TaskHealthResult> => {
    const completedAt = new Date().toISOString()
    await db.tasks.finishHealthRun(taskId, token, 'failed', completedAt, details.logPath, inspection.path, claimGeneration, executionMode)
    return { taskId, state, status: null, scriptPath: inspection.path, startedAt, completedAt, expiresAt: null, runId: token, claimGeneration, executionMode, ...details }
  }

  if (inspection.state !== 'ready') {
    return failed(inspection.state, {
      tail: '', logPath: null, message: inspection.message, adaptFrom: inspection.adaptFrom,
    })
  }

  try {
    const execution = executeHealthCheck(cwd, inspection.path)
    const completedAt = new Date().toISOString()
    const passed = !execution.error && execution.status === 0
    await db.tasks.finishHealthRun(taskId, token, passed ? 'passed' : 'failed', completedAt, execution.logPath, inspection.path, claimGeneration, executionMode)
    return {
      taskId,
      state: passed ? 'passed' : 'failed',
      status: execution.status,
      tail: execution.tail,
      logPath: execution.logPath,
      scriptPath: inspection.path,
      startedAt,
      completedAt,
      expiresAt: passed ? new Date(Date.parse(completedAt) + HEALTH_EVIDENCE_TTL_MS).toISOString() : null,
      runId: token,
      claimGeneration,
      executionMode,
      ...(execution.error ? { message: execution.error.message } : {}),
    }
  } catch (error) {
    return failed('failed', { tail: '', logPath: null, message: error instanceof Error ? error.message : String(error) })
  }
}
