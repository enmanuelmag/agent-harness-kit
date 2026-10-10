export const NORMALIZED = Symbol('normalized MCP arguments')
function isNormalized(args: Record<string, unknown>, key: string): boolean {
  return (args as Record<symbol, Set<string>>)[NORMALIZED]?.has(key) ?? false
}

export const INPUT_ERROR = Symbol('MCP input error')

export function assertNormalized(args: Record<string, unknown>): void {
  const error = (args as Record<symbol, unknown>)[INPUT_ERROR]
  if (error) throw error
}

export function str(args: Record<string, unknown>, key: string): string {
  if (isNormalized(args, key)) return args[key] as string
  const v = args[key]
  if (!v) throw new Error(`${key} is required`)
  return String(v)
}

export function num(args: Record<string, unknown>, key: string): number {
  if (isNormalized(args, key)) return args[key] as number
  const v = Number(args[key])
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`${key} must be a number`)
  return v
}

export function optionalStr(args: Record<string, unknown>, key: string): string | undefined {
  if (isNormalized(args, key)) return args[key] as string | undefined
  const value = args[key]
  if (value === undefined) return undefined
  return String(value)
}
export function boundedInt(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (isNormalized(args, key)) return (args[key] as number | undefined) ?? fallback
  const raw = args[key]
  if (raw === undefined) return fallback

  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`)
  }
  return value
}
export function optionalStringArray(
  args: Record<string, unknown>,
  key: string
): string[] | undefined {
  if (isNormalized(args, key)) return args[key] as string[] | undefined
  const value = args[key]

  if (value === null) return []

  if (value === undefined) return undefined

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter((item) => item.trim() !== '')
      }
    } catch {
      throw new Error(
        `${key} must be an array of non-empty strings or a JSON string representing such an array`
      )
    }
  }

  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of non-empty strings`)
  }

  return value.map((item) => String(item)).filter((item) => item.trim() !== '')
}

export function requiredStringArray(args: Record<string, unknown>, key: string): string[] {
  if (!(key in args)) throw new Error(`${key} is required`)
  return optionalStringArray(args, key) ?? []
}
