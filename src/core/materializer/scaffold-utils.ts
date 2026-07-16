import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GITIGNORE_ENTRIES } from './templates'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function writeAgentFile(cwd: string, relPath: string, content: string): void {
  const abs = join(cwd, relPath)
  if (existsSync(abs)) return // preserve dev customizations
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

export function writeSkills(cwd: string, skillsDir: string): void {
  const skillNames = ['ahk-ask', 'ahk-consultant', 'ahk-triage', 'ahk-review']
  for (const skillName of skillNames) {
    const src = join(__dirname, 'skills', skillName, 'SKILL.md')
    const destDir = join(cwd, skillsDir, skillName)
    const dest = join(destDir, 'SKILL.md')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(dest, readFileSync(src, 'utf8'), 'utf8')
  }
}

/**
 * Writes a single skill under an already-resolved absolute `skillsRoot`,
 * preserving the file if it already exists (same "preserve dev
 * customizations" idempotency criterion as writeAgentFile). Used by the
 * global sync flow, which needs to add only the skills that are missing
 * rather than unconditionally overwriting every skill like writeSkills()
 * does for project-local scaffold/build.
 */
export function writeSkill(skillsRoot: string, skillName: string): void {
  const src = join(__dirname, 'skills', skillName, 'SKILL.md')
  const destDir = join(skillsRoot, skillName)
  const dest = join(destDir, 'SKILL.md')
  if (existsSync(dest)) return // preserve — already present
  mkdirSync(destDir, { recursive: true })
  writeFileSync(dest, readFileSync(src, 'utf8'), 'utf8')
}

