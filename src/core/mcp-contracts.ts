import { type CallToolResult, type StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { recoveryFor } from './mcp-field-recovery'
import * as normalizers from './mcp-normalizers'
import { TOOLS } from './mcp-tools'

/** Compile without strict mode: unsupported forms retain Zod's normal parser. */
export function compileContract<T extends z.ZodType>(schema: T): T {
  return z.compile(schema)
}

/** Tolerant admission is derived from canonical fields, never re-parsed through them. */
export function deriveInputContract(canonical: z.ZodObject): z.ZodType<Record<string, unknown>> {
  const fields = Object.fromEntries(
    Object.keys(canonical.shape).map((key) => [key, z.unknown().optional()])
  )
  const rules = Object.entries(canonical.shape)
    .flatMap(([key, field]) => {
      const metadata = recoveryFor(field)
      return metadata ? [{ key, field, ...metadata }] : []
    })
    .sort((a, b) => a.order - b.order)
  return compileContract(
    z.object(fields).transform((args) => {
      const normalizedKeys = new Set<string>()
      try {
        for (const { key, field, normalize } of rules) {
          if (!(key in args) && field.isOptional()) continue
          args[key] = normalize(args, key)
          normalizedKeys.add(key)
        }
      } catch (error) {
        // Preserve legacy helper failure text/notices at the execution boundary.
        Object.defineProperty(args, normalizers.INPUT_ERROR, { value: error })
      }
      Object.defineProperty(args, normalizers.NORMALIZED, { value: normalizedKeys })
      return args
    })
  )
}

export const inputContracts = Object.fromEntries(
  TOOLS.map((tool) => [tool.name, deriveInputContract(tool.inputSchema)])
)

/** Keep canonical argument guidance while executable parsing accepts legacy recovery. */
export const sdkInputContracts: Record<
  string,
  StandardSchemaWithJSON<unknown, Record<string, unknown>>
> = Object.fromEntries(
  TOOLS.map((tool) => {
    const standard = inputContracts[tool.name]['~standard']
    const publishedInput = z.toJSONSchema(tool.inputSchema, { io: 'input' })
    return [
      tool.name,
      {
        '~standard': {
          ...standard,
          jsonSchema: {
            ...standard.jsonSchema,
            input: () => publishedInput,
          },
        },
      },
    ]
  })
)

export const outputContracts = Object.fromEntries(
  TOOLS.map((tool) => [tool.name, compileContract(tool.outputSchema)])
)

/** Validate and emit the stripped DTO; keep the legacy text and notices untouched. */
export function structuredResult(name: string, result: CallToolResult): CallToolResult {
  if (result.isError || !outputContracts[name]) return result
  const first = result.content[0]
  if (first?.type !== 'text') throw new Error(`Missing text result for ${name}`)
  const value: unknown = JSON.parse(first.text)
  const dto = Array.isArray(value) ? { items: value } : value === null ? { value } : value
  return {
    ...result,
    structuredContent: outputContracts[name].parse(dto) as Record<string, unknown>,
  }
}
