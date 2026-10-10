import { z } from 'zod'

interface RecoveryMetadata {
  normalize: (args: Record<string, unknown>, key: string) => unknown
  /** Preserve legacy validation order without another field-name lookup table. */
  order: number
}

// Private registry: closures and compatibility rules never enter JSON guidance.
const recoveryRegistry = z.registry<RecoveryMetadata>()

export function recover<T extends z.ZodType>(
  field: T,
  normalize: RecoveryMetadata['normalize'],
  order = 0
): T {
  recoveryRegistry.add(field, { normalize, order })
  return field
}

export function recoveryFor(field: z.ZodType): RecoveryMetadata | undefined {
  return recoveryRegistry.get(field)
}
