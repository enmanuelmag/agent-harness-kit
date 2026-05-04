import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { GITIGNORE_ENTRIES } from './templates.js'

export function writeAgentFile(cwd: string, relPath: string, content: string): void {
  const abs = join(cwd, relPath)
  if (existsSync(abs)) return  // preserve dev customizations
  mkdirSync(resolve(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

export function appendGitignore(cwd: string): void {
  const giPath = join(cwd, '.gitignore')
  const existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''

  const toAdd = GITIGNORE_ENTRIES.split('\n')
    .filter((line) => line && !existing.includes(line))
    .join('\n')

  if (toAdd.trim()) {
    writeFileSync(giPath, existing + (existing.endsWith('\n') ? '' : '\n') + toAdd + '\n', 'utf8')
  }
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
