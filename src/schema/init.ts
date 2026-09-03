import * as v from 'valibot'

export const initNameSchema = v.pipe(
  v.string(),
  v.nonEmpty('Project name is required'),
  v.minLength(3, 'Project name must be at least 3 characters'),
  v.maxLength(50, 'Project name must be at most 50 characters'),
  v.trim()
)

export const initDescriptionSchema = v.pipe(
  v.string(),
  v.nonEmpty('Description is required'),
  v.maxLength(300, 'Description must be at most 300 characters'),
  v.trim()
)

export const initDocsSchema = v.pipe(
  v.string(),
  v.nonEmpty('Docs folder path is required'),
  v.regex(
    /^[\w\-./]+$/,
    'Docs folder path can only contain letters, numbers, dashes, underscores, dots, and slashes'
  ),
  v.trim()
)
