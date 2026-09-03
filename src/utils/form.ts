import * as p from '@clack/prompts'
import * as v from 'valibot'

export const cliFormWithRetry = async <T>(
  formFn: () => Promise<T>,
  schema: v.GenericSchema
): Promise<T> => {
  while (true) {
    const res = await formFn()
    const result = v.safeParse(schema, res)

    if (result.success) return result.output as T

    const messages = result.issues.map((i) => i.message).join(', ')
    p.log.error(messages)
    p.log.info('Please try again.\n')
  }
}
