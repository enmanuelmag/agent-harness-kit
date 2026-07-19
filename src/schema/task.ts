import * as v from 'valibot'

export const taskTitleSchema = v.pipe(
  v.string(),
  v.nonEmpty('Task title is required'),
  v.minLength(3, 'Task title must be at least 3 characters'),
  v.maxLength(100, 'Task title must be at most 100 characters'),
)

export const taskDescriptionSchema = v.pipe(
  v.string(),
  v.nonEmpty('Description is required'),
)
