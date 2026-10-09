import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { runMigrateSpecs } from '@/commands/migrate-specs'

const roots: string[] = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})
test('spec migration only updates frontmatter on explicit apply', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-migrate-specs-'))
  roots.push(cwd)
  mkdirSync(join(cwd, 'docs/specs'), { recursive: true })
  writeFileSync(
    join(cwd, 'agent-harness-kit.config.json'),
    JSON.stringify({
      project: { name: 'x', description: 'x', docsPath: './docs' },
      provider: 'claude-code',
      database: { type: 'sqlite' },
      storage: {
        dir: '.harness',
        sections: {
          toolsUsed: true,
          filesModified: true,
          result: true,
          blockers: true,
          nextSteps: false,
        },
        scope: 'local',
        projectId: 'x',
      },
      health: { scriptPath: './health.sh', required: false },
      tools: {
        mcp: { enabled: false, port: 1 },
        scripts: { enabled: false, outputDir: '.harness/scripts' },
      },
    })
  )
  const doc = '---\nspec_kind: use-case\n---\nExample: spec_kind: technical\n'
  writeFileSync(join(cwd, 'docs/specs/a.md'), doc)
  await runMigrateSpecs(cwd)
  assert.equal(readFileSync(join(cwd, 'docs/specs/a.md'), 'utf8'), doc)
  await runMigrateSpecs(cwd, { apply: true })
  assert.match(readFileSync(join(cwd, 'docs/specs/a.md'), 'utf8'), /^---\nspec_kind: spec\n---/)
  assert.match(readFileSync(join(cwd, 'docs/specs/a.md'), 'utf8'), /Example: spec_kind: technical/)
})

test('does not change a fenced body example when frontmatter is already current', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-migrate-specs-'))
  roots.push(cwd)
  mkdirSync(join(cwd, 'docs/specs'), { recursive: true })
  writeFileSync(
    join(cwd, 'agent-harness-kit.config.json'),
    JSON.stringify({
      project: { name: 'x', description: 'x', docsPath: './docs' },
      provider: 'claude-code',
      database: { type: 'sqlite' },
      storage: {
        dir: '.harness',
        sections: {
          toolsUsed: true,
          filesModified: true,
          result: true,
          blockers: true,
          nextSteps: false,
        },
        scope: 'local',
        projectId: 'x',
      },
      health: { scriptPath: './health.sh', required: false },
      tools: {
        mcp: { enabled: false, port: 1 },
        scripts: { enabled: false, outputDir: '.harness/scripts' },
      },
    })
  )
  const doc =
    '---\r\nspec_kind: feature\r\nstatus: approved\r\n---\r\n```yaml\r\nspec_kind: use-case\r\n```\r\n'
  const path = join(cwd, 'docs/specs/example.md')
  writeFileSync(path, doc)
  await runMigrateSpecs(cwd)
  await runMigrateSpecs(cwd, { apply: true })
  await runMigrateSpecs(cwd, { apply: true })
  assert.equal(readFileSync(path, 'utf8'), doc)
})

test('preserves CRLF body bytes and refuses symlinked paths before migration', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-migrate-specs-'))
  roots.push(cwd)
  mkdirSync(join(cwd, 'docs/specs/nested'), { recursive: true })
  writeFileSync(
    join(cwd, 'agent-harness-kit.config.json'),
    JSON.stringify({
      project: { name: 'x', description: 'x', docsPath: './docs' },
      provider: 'claude-code',
      database: { type: 'sqlite' },
      storage: { dir: '.harness', sections: {}, scope: 'local', projectId: 'x' },
      health: { scriptPath: './health.sh', required: false },
      tools: { mcp: { enabled: false, port: 1 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
    })
  )
  const path = join(cwd, 'docs/specs/nested/a.md')
  const body = 'Body stays\r\nbyte-for-byte\r\n'
  writeFileSync(path, `---\r\nspec_kind: technical\r\n---\r\n${body}`)
  await runMigrateSpecs(cwd, { apply: true })
  const result = readFileSync(path)
  assert.equal(result.subarray(result.indexOf(Buffer.from(body))).toString('binary'), Buffer.from(body).toString('binary'))
  mkdirSync(join(cwd, 'outside'))
  symlinkSync(join(cwd, 'outside'), join(cwd, 'docs/specs/link'))
  await assert.rejects(() => runMigrateSpecs(cwd), /symlinked specification document/)
})
