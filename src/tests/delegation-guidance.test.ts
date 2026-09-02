import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { agentBuilder, agentConsultant, agentExplorer, agentLead, agentReviewer } from '@/core/materializer/templates'
import { renderDelegationGuidance } from '@/core/materializer/delegation-guidance'

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
