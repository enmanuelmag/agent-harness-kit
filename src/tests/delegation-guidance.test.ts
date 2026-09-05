import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

    it('uses Codex-native delegation guidance without invented commands', () => {
      const result = renderDelegationGuidance('codex-cli', 'lead')
      assert.ok(result.includes('bounded, independent work'))
      assert.ok(result.includes('delegate'), 'should mention delegate')
      assert.ok(result.includes('Parallel'))
      assert.ok(result.includes('Inspect Progress'), 'should have Inspect Progress key')
      assert.ok(result.includes('/agent'), 'should mention the interactive inspection command')
      assert.ok(!result.includes('spawn → delegate → wait → summarize'))
      assert.ok(!result.includes('status commands'))
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
      assert.ok(
        result.includes('## Provider Delegation Guidance'),
        'should contain delegation section heading'
      )
      assert.ok(result.includes(guidance), 'should contain the rendered guidance text')
    })

    it('omits Provider Delegation Guidance when no delegationGuidance is provided', () => {
      const result = agentLead({ projectName: 'TestProject' })
      assert.ok(
        !result.includes('## Provider Delegation Guidance'),
        'should NOT contain delegation section'
      )
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
      const result = agentLead(
        { projectName: 'TestProject' },
        '',
        renderDelegationGuidance('claude-code', 'lead')
      )
      assert.ok(result.includes('## Provider Delegation Guidance'))
      assert.ok(result.includes('@'))
    })

    it('opencode lead gets delegation guidance', () => {
      const result = agentLead(
        { projectName: 'TestProject' },
        '',
        renderDelegationGuidance('opencode', 'lead')
      )
      assert.ok(result.includes('## Provider Delegation Guidance'))
      assert.ok(result.includes('@'))
    })

    it('codex-cli lead gets delegation guidance', () => {
      const result = agentLead(
        { projectName: 'TestProject' },
        '',
        renderDelegationGuidance('codex-cli', 'lead')
      )
      assert.ok(result.includes('## Provider Delegation Guidance'))
      assert.ok(result.includes('bounded, independent work'))
      assert.ok(result.includes('delegate'))
      assert.ok(result.includes('/agent'))
    })

    it('grok-cli lead gets delegation guidance', () => {
      const result = agentLead(
        { projectName: 'TestProject' },
        '',
        renderDelegationGuidance('grok-cli', 'lead')
      )
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

  it('inserts after YAML frontmatter when the document has no H1', () => {
    const manifest = '---\nname: test\ndescription: test skill\n---\n\nBody.\n'
    const guidance = renderDelegationGuidance('claude-code', 'coordination-skill')
    const result = injectDelegationGuidance(manifest, guidance)

    assert.match(result, /^---\nname: test\ndescription: test skill\n---\n\n/)
    assert.ok(result.includes('## Provider Delegation Guidance'))
    assert.ok(result.includes(guidance))
    assert.ok(result.indexOf('## Provider Delegation Guidance') < result.indexOf('Body.'))
  })
})

describe('coordination skill injection', () => {
  it('writeSkills injects guidance into canonical manifests and preserves resources byte-for-byte', () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'ahk-test-'))
    try {
      const guidance = renderDelegationGuidance('claude-code', 'coordination-skill')
      const srcDir = join(__dirname, '../../src/core/materializer/skills')
      writeSkills(tmpDir, '.skills', guidance)

      for (const skillName of [
        'ahk-ask',
        'ahk-consultant',
        'ahk-triage',
        'ahk-review',
        'ahk-test',
        'ahk-use-cases',
        'ahk-use-case-tech',
      ]) {
        const result = readFileSync(join(tmpDir, '.skills', skillName, 'SKILL.md'), 'utf8')
        assert.ok(result.includes('## Provider Delegation Guidance'), `${skillName} should contain guidance`)
        assert.ok(result.includes(guidance), `${skillName} should contain rendered guidance`)
      }

      for (const resourcePath of [
        'ahk-use-cases/resources/discovery-workflow.md',
        'ahk-use-cases/resources/use-case-template.md',
        'ahk-use-case-tech/resources/technical-template.md',
        'ahk-use-case-tech/resources/technical-workflow.md',
      ]) {
        assert.deepEqual(
          readFileSync(join(tmpDir, '.skills', resourcePath)),
          readFileSync(join(srcDir, resourcePath)),
          `${resourcePath} should remain byte-for-byte identical`
        )
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('writeSkills without guidance produces byte-for-byte copy', () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'ahk-test-'))
    try {
      const srcDir = join(__dirname, '../../src/core/materializer/skills')
      writeSkills(tmpDir, '.skills')
      for (const skillName of [
        'ahk-ask',
        'ahk-consultant',
        'ahk-triage',
        'ahk-review',
        'ahk-test',
      ]) {
        const source = readFileSync(join(srcDir, skillName, 'SKILL.md'), 'utf8')
        const dest = readFileSync(join(tmpDir, '.skills', skillName, 'SKILL.md'), 'utf8')
        assert.equal(dest, source, `${skillName} should be byte-for-byte copy`)
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
