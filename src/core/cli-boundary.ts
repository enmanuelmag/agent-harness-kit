import { type BoundaryFailure, capture, type Result } from './result'

export function terminateCliFailure(error: BoundaryFailure): never {
  process.stderr.write(`[agent-harness-kit] ${error.context}: ${error.message}\n`)
  // exitCode alone leaves failed startups alive when sockets/watchers exist.
  process.exit(1)
}

export async function runCliBoundary(
  operation: () => unknown | Promise<unknown>,
  context: string | (() => string)
): Promise<void> {
  const result = await capture(operation, context)
  if (!result.ok) terminateCliFailure(result.error)
}

/** Advisory reporting never changes a completed operation's status. */
export async function reportCliAdvisory<T>(
  pending: Promise<Result<T, BoundaryFailure>>,
  report: (value: T) => void
): Promise<void> {
  const result = await capture(async () => {
    const advisory = await pending
    if (!advisory.ok) return advisory
    report(advisory.value)
    return advisory
  }, 'update notice')
  const failure = !result.ok ? result.error : !result.value.ok ? result.value.error : undefined
  if (failure)
    process.stderr.write(`[agent-harness-kit] Advisory ${failure.context}: ${failure.message}\n`)
}
