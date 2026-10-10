export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export interface BoundaryFailure {
  context: string
  message: string
  cause: unknown
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

/** Capture sync throws and awaited rejections without losing the original cause. */
export async function capture<T>(
  operation: () => T | Promise<T>,
  context: string | (() => string)
): Promise<Result<T, BoundaryFailure>> {
  try {
    return ok(await operation())
  } catch (cause) {
    return err({
      context: typeof context === 'function' ? context() : context,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    })
  }
}
