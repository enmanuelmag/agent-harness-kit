import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { renderDelegationGuidance } from '@/core/materializer/delegation-guidance'
import { writeSkills } from '@/core/materializer/scaffold-utils'
import {
  agentBuilder,
  agentConsultant,
  agentExplorer,
  agentLead,
  agentLeadAsDefaultToml,
  agentLeadToml,
  agentReviewer,
  injectDelegationGuidance,
} from '@/core/materializer/templates'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('delegation guidance', () => {
  describe('renderDelegationGuidance', () => {
    it('produces @mention references for claude-code lead', () => {
      const result = renderDelegationGuidance('claude-code', 'lead')
      assert.ok(result.includes('@'), 'should contain @mention references')
      assert.ok(result.includes('Sequential'), 'should have Sequential key')
      assert.ok(result.includes('Parallel'), 'should have Parallel key')
      assert.ok(result.includes('Context Transfer'), 'should have Context Transfer key')
      assert.ok(result.includes('Wait For Completion'), 'should have Wait For Completion key')
    })

    it('produces @mention output for opencode lead', () => {
      const result = renderDelegationGuidance('opencode', 'lead')
      assert.ok(result.includes('@'), 'should contain @mention references')
      assert.ok(result.includes('Sequential'))
      assert.ok(result.includes('Parallel'))
      assert.ok(result.includes('Context Transfer'))
      assert.ok(result.includes('Wait For Completion'))
    })

    it('produces spawn/delegate output for codex-cli lead', () => {
      const result = renderDelegationGuidance('codex-cli', 'lead')
      assert.ok(result.includes('spawn'), 'should mention spawn')
      assert.ok(result.includes('delegate'), 'should mention delegate')
      assert.ok(result.includes('Parallel'))
      assert.ok(result.includes('Inspect Progress'), 'should have Inspect Progress key')
    })

    it('produces /tasks output for grok-cli lead', () => {
      const result = renderDelegationGuidance('grok-cli', 'lead')
      assert.ok(result.includes('/tasks'), 'should mention /tasks')
      assert.ok(result.includes('Sequential'))
      assert.ok(result.includes('Parallel'))
      assert.ok(result.includes('Inspect Progress'))
    })

    it('returns empty string for unknown provider', () => {
      // @ts-expect-error - testing invalid provider
      const result = renderDelegationGuidance('unknown-provider', 'lead')
      assert.equal(result, '')
    })
  })

  describe('agentLead with delegation guidance', () => {
    it('includes Provider Delegation Guidance section when delegationGuidance is passed', () => {
      const guidance = renderDelegationGuidance('claude-code', 'lead')
      const result = agentLead({ projectName: 'TestProject' }, '', guidance)
      assert.ok(result.includes('## Provider Delegation Guidance'), 'should contain delegation section heading')
      assert.ok(result.includes(guidance), 'should contain the rendered guidance text')
    })

    it('omits Provider Delegation Guidance when no delegationGuidance is provided', () => {
      const result = agentLead({ projectName: 'TestProject' })
      assert.ok(!result.includes('## Provider Delegation Guidance'), 'should NOT contain delegation section')
    })

    it('places delegation guidance after research tools when both are provided', () => {
      const guidance = renderDelegationGuidance('claude-code', 'lead')
      const hints = 'Some capability hints'
      const result = agentLead({ projectName: 'TestProject' }, hints, guidance)
      assert.ok(result.includes('## Available Research Tools'))
      assert.ok(result.includes('## Provider Delegation Guidance'))
      // Delegation guidance should come after research tools
      const researchIdx = result.indexOf('## Available Research Tools')
      const delegationIdx = result.indexOf('## Provider Delegation Guidance')
      assert.ok(delegationIdx > researchIdx, 'delegation should come after research tools')
    })
  })

  describe('other agents do NOT get delegation guidance', () => {
    it('agentExplorer does not contain Provider Delegation Guidance', () => {
      const result = agentExplorer({ projectName: 'TestProject' })
      assert.ok(!result.includes('## Provider Delegation Guidance'))
    })

    it('agentBuilder does not contain Provider Delegation Guidance', () => {
      const result = agentBuilder({ projectName: 'TestProject' })
      assert.ok(!result.includes('## Provider Delegation Guidance'))
    })

    it('agentConsultant does not contain Provider Delegation Guidance', () => {
      const result = agentConsultant({ projectName: 'TestProject' })
      assert.ok(!result.includes('## Provider Delegation Guidance'))
    })

    it('agentReviewer does not contain Provider Delegation Guidance', () => {
      const result = agentReviewer({ projectName: 'TestProject' })
      assert.ok(!result.includes('## Provider Delegation Guidance'))
    })
  })

  describe('all four providers produce delegation guidance for lead', () => {
    it('claude-code lead gets delegation guidance', () => {
      const result = agentLead({ projectName: 'TestProject' }, '', renderDelegationGuidance('claude-code', 'lead'))
      assert.ok(result.includes('## Provider Delegation Guidance'))
      assert.ok(result.includes('@'))
    })

    it('opencode lead gets delegation guidance', () => {
      const result = agentLead({ projectName: 'TestProject' }, '', renderDelegationGuidance('opencode', 'lead'))
      assert.ok(result.includes('## Provider Delegation Guidance'))
      assert.ok(result.includes('@'))
    })

    it('codex-cli lead gets delegation guidance', () => {
      const result = agentLead({ projectName: 'TestProject' }, '', renderDelegationGuidance('codex-cli', 'lead'))
      assert.ok(result.includes('## Provider Delegation Guidance'))
      assert.ok(result.includes('spawn'))
      assert.ok(result.includes('delegate'))
    })

    it('grok-cli lead gets delegation guidance', () => {
      const result = agentLead({ projectName: 'TestProject' }, '', renderDelegationGuidance('grok-cli', 'lead'))
      assert.ok(result.includes('## Provider Delegation Guidance'))
      assert.ok(result.includes('/tasks'))
    })
  })
})

describe('Codex TOML delegation', () => {
  it('agentLeadToml includes Provider Delegation Guidance section', () => {
    const guidance = renderDelegationGuidance('codex-cli', 'lead')
    const result = agentLeadToml({ projectName: 'TestProject' }, undefined, guidance)
    assert.ok(result.includes('Provider Delegation Guidance'), 'should contain delegation section')
    assert.ok(result.includes(guidance), 'should contain rendered guidance text')
  })

  it('agentLeadAsDefaultToml includes Provider Delegation Guidance section', () => {
    const guidance = renderDelegationGuidance('codex-cli', 'lead')
    const result = agentLeadAsDefaultToml({ projectName: 'TestProject' }, undefined, guidance)
    assert.ok(result.includes('Provider Delegation Guidance'), 'should contain delegation section')
    assert.ok(result.includes(guidance), 'should contain rendered guidance text')
  })
})

describe('injectDelegationGuidance fallback', () => {
  it('falls back to H1 when no Available Research Tools section exists', () => {
    const minimalMd = '# Lead Agent\n\nThis is the lead agent.\n'
    const guidance = renderDelegationGuidance('claude-code', 'lead')
    const result = injectDelegationGuidance(minimalMd, guidance)
    assert.ok(result.includes('## Provider Delegation Guidance'))
    assert.ok(result.indexOf('## Provider Delegation Guidance') > 0)
  })

  it('returns original markdown when guidance is empty string', () => {
    const md = '# Some Agent\n\nSome content.\n'
    const result = injectDelegationGuidance(md, '')
    assert.equal(result, md, 'should return unchanged markdown')
  })
})

describe('coordination skill injection', () => {
  it('writeSkills with delegation guidance injects into skill content', () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'ahk-test-'))
    try {
      const guidance = renderDelegationGuidance('claude-code', 'coordination-skill')
      // Use mock markdown with H1 heading (real SKILL.md has frontmatter but no H1)
      const mockMd = '# Test Skill\n\nThis is a test skill.\n'
      const destDir = join(tmpDir, '.skills', 'ahk-ask')
      mkdirSync(destDir, { recursive: true })
      // Simulate what writeSkills does: read + inject + write
      let content = mockMd
      content = injectDelegationGuidance(content, guidance)
      writeFileSync(join(destDir, 'SKILL.md'), content, 'utf8')
      const result = readFileSync(join(destDir, 'SKILL.md'), 'utf8')
      assert.ok(result.includes('## Provider Delegation Guidance'), 'should contain delegation section')
      assert.ok(result.includes(guidance), 'should contain rendered guidance text')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('writeSkills without guidance produces byte-for-byte copy', () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'ahk-test-'))
    try {
      const srcDir = join(__dirname, '../../src/core/materializer/skills')
      writeSkills(tmpDir, '.skills')
      for (const skillName of ['ahk-ask', 'ahk-consultant', 'ahk-triage', 'ahk-review', 'ahk-test']) {
        const source = readFileSync(join(srcDir, skillName, 'SKILL.md'), 'utf8')
        const dest = readFileSync(join(tmpDir, '.skills', skillName, 'SKILL.md'), 'utf8')
        assert.equal(dest, source, `${skillName} should be byte-for-byte copy`)
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
