import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { getMaterializer } from '@/core/materializer/index'
import {
  buildCapabilityHints,
  getResearchCapabilities,
} from '@/core/materializer/provider-research-capabilities'
import {
  agentConsultant,
  agentExplorer,
  agentLead,
  agentReviewer,
  agentsMd,
} from '@/core/materializer/templates'

const PROJECT_NAME = 'demo-app'

// ─── research-policy — lead instructions contain research triggers ──────────────

describe('research-policy — lead instructions contain research triggers', () => {
  test('agentLead contains research trigger conditions', () => {
    const lead = agentLead({ projectName: PROJECT_NAME })
    assert.ok(lead.includes('Research IS required'), 'must list when research is required')
    assert.ok(
      lead.includes('library, framework, SDK, API, CLI, cloud service'),
      'must mention library/framework/SDK/API/CLI/cloud service'
    )
    assert.ok(lead.includes('Research is NOT required'), 'must list when research is not required')
    assert.ok(
      lead.includes('Isolated business-logic debugging'),
      'must mention business-logic debugging exclusion'
    )
  })

  test('agentLead contains bounded-delegation rules', () => {
    const lead = agentLead({ projectName: PROJECT_NAME })
    assert.ok(lead.includes('Sources to consult'), 'must mention specifying sources')
    assert.ok(lead.includes('Installed versions'), 'must mention specifying installed versions')
    assert.ok(
      lead.includes('dependency-impact conclusion'),
      'must mention dependency-impact template'
    )
  })

  test('agentLead delegates to consultant with version-aware guidance', () => {
    const lead = agentLead({ projectName: PROJECT_NAME })
    assert.ok(
      lead.includes('inspect manifests') ||
        lead.includes('manifests') ||
        lead.includes('installed version'),
      'must delegate consultant with version-aware guidance'
    )
    assert.ok(
      lead.includes('Context7') || lead.includes('context7'),
      'must mention Context7 in delegation'
    )
    assert.ok(
      lead.includes('Mintlify Index') || lead.includes('mintlify'),
      'must mention Mintlify Index in delegation'
    )
  })
})

// ─── research-policy — consultant prioritizes Context7 ──────────────

describe('research-policy — consultant prioritizes Context7', () => {
  test('agentConsultant contains Dependency-Bound Research Protocol', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.ok(
      consultant.includes('Dependency-Bound Research Protocol'),
      'must have protocol section'
    )
    assert.ok(consultant.includes('Inspect first'), 'must instruct to inspect first')
    assert.ok(consultant.includes('Resolve Context7'), 'must prioritize Context7')
    assert.ok(consultant.includes('Query one concept'), 'must query one concept at a time')
    assert.ok(consultant.includes('Compare'), 'must compare with installed version')
    assert.ok(consultant.includes('Fallback'), 'must describe fallback')
    assert.ok(consultant.includes('State impact explicitly'), 'must state impact explicitly')
  })

  test('agentConsultant source order section exists', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.ok(consultant.includes('Source Order'), 'must have source order subsection')
    assert.ok(
      consultant.includes('Current project evidence'),
      'source order must start with project evidence'
    )
    assert.ok(consultant.includes('Context7'), 'source order must include Context7')
    assert.ok(consultant.includes('Mintlify Index'), 'source order must include Mintlify Index')
  })

  test('agentConsultant dependency-impact template is present', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.ok(
      consultant.includes('Dependency-Impact Conclusion') ||
        consultant.includes('Dependency-Impact conclusion'),
      'must have impact conclusion subsection'
    )
    assert.ok(
      consultant.includes('Installed version(s)'),
      'template must list installed version(s)'
    )
    assert.ok(consultant.includes('Compatibility'), 'template must list compatibility')
    assert.ok(consultant.includes('Upgrade required'), 'template must list upgrade required')
    assert.ok(
      consultant.includes('New dependency required'),
      'template must list new dependency required'
    )
    assert.ok(
      consultant.includes('Proposed version or package'),
      'template must list proposed version'
    )
    assert.ok(consultant.includes('Evidence'), 'template must list evidence')
    assert.ok(consultant.includes('uncertain'), 'template must mention uncertain state')
  })
})

// ─── research-policy — local evidence precedes external recommendations ──────────────

describe('research-policy — local evidence precedes external recommendations', () => {
  test('consultant source order puts project evidence first', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    const evidenceIdx = consultant.indexOf('Current project evidence')
    const context7Idx = consultant.indexOf('Context7 with exact library')
    assert.ok(
      evidenceIdx > 0 && context7Idx > evidenceIdx,
      'project evidence must come before Context7 in source order'
    )
  })

  test('explorer must identify manifests and lockfiles', () => {
    const explorer = agentExplorer({ projectName: PROJECT_NAME })
    assert.ok(
      explorer.includes('Version and Dependency Mapping'),
      'must have version mapping section'
    )
    assert.ok(explorer.includes('package.json'), 'must mention package.json')
    assert.ok(
      explorer.includes('pnpm-lock.yaml') || explorer.includes('yarn.lock'),
      'must mention lockfiles'
    )
    assert.ok(explorer.includes('installed versions'), 'must mention installed versions')
    assert.ok(
      explorer.includes('Do NOT recommend upgrades'),
      'must prohibit recommending upgrades without explicit request'
    )
  })
})

// ─── research-policy — Mintlify Index and web search as fallbacks ──────────────

describe('research-policy — Mintlify Index and web search as fallbacks', () => {
  test('Mintlify Index appears as fallback, not universal requirement', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.ok(consultant.includes('Mintlify Index'), 'must mention Mintlify Index')
    assert.ok(
      consultant.includes('fallback') ||
        consultant.includes('lacks coverage') ||
        consultant.includes('unavailable'),
      'must describe Mintlify Index as fallback'
    )
  })

  test('web search appears as fallback, not universal requirement', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.ok(
      consultant.includes('official web sources') ||
        consultant.includes('web search') ||
        consultant.includes('web documentation'),
      'must mention web sources'
    )
    assert.ok(
      consultant.includes('fallback') ||
        consultant.includes('lacks coverage') ||
        consultant.includes('unavailable'),
      'must describe web search as fallback'
    )
  })
})

// ─── research-policy — Graphify and Autoskills not described as documentation evidence ──────────────

describe('research-policy — Graphify and Autoskills not described as documentation evidence', () => {
  test('docs plan clarifies Graphify does not replace documentation', () => {
    const planDoc = readFileSync(
      join(import.meta.dirname, '../../docs/documentation-research-policy-plan.md'),
      'utf8'
    )
    assert.ok(planDoc.includes('Graphify'), 'must mention Graphify')
    assert.ok(
      planDoc.includes('does not replace') ||
        planDoc.includes('does not substitute') ||
        planDoc.includes('not documentation'),
      'must state Graphify does not replace documentation'
    )
  })

  test('docs plan clarifies Autoskills does not prove library APIs', () => {
    const planDoc = readFileSync(
      join(import.meta.dirname, '../../docs/documentation-research-policy-plan.md'),
      'utf8'
    )
    assert.ok(planDoc.includes('Autoskills'), 'must mention Autoskills')
    assert.ok(
      planDoc.includes('does not prove') ||
        planDoc.includes('not documentation') ||
        planDoc.includes('discovery'),
      'must state Autoskills does not prove library APIs'
    )
  })
})

// ─── research-policy — provider-native tool names do not leak into shared policy ──────────────

describe('research-policy — provider-native tool names do not leak into shared policy', () => {
  test('lead research section contains expected phrases', () => {
    const lead = agentLead({ projectName: PROJECT_NAME })
    assert.ok(lead.includes('Research IS required when:'), 'must have research IS required header')
    assert.ok(
      lead.includes('library, framework, SDK, API, CLI, cloud service'),
      'must mention library/framework/SDK/API/CLI/cloud service'
    )
    assert.ok(
      lead.includes('Research is NOT required for:'),
      'must have research NOT required header'
    )
    assert.ok(
      lead.includes('Isolated business-logic debugging'),
      'must mention business-logic debugging exclusion'
    )
    assert.ok(lead.includes('Context7 library IDs'), 'must mention Context7')
    assert.ok(lead.includes('Mintlify Index'), 'must mention Mintlify Index')
  })

  test('consultant template does not contain provider-specific tool names', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.doesNotMatch(consultant, /claude_code_/i, 'must not leak Claude Code tool naming')
    assert.doesNotMatch(consultant, /opencode_/i, 'must not leak OpenCode tool naming')
    assert.doesNotMatch(consultant, /codex_/i, 'must not leak Codex tool naming')
  })

  test('agentsMd() does not contain provider-native tool names', () => {
    const config = applyConfigDefaults({
      name: PROJECT_NAME,
      description: 'test',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
    })
    const md = agentsMd(config)
    assert.doesNotMatch(md, /mcp__/, 'agentsMd must not contain provider-native MCP patterns')
  })
})

// ─── research-policy — every provider receives valid capability hint ──────────────

describe('research-policy — every provider receives valid capability hint', () => {
  const providers: Array<'claude-code' | 'opencode' | 'codex-cli' | 'grok-cli'> = [
    'claude-code',
    'opencode',
    'codex-cli',
    'grok-cli',
  ]

  for (const provider of providers) {
    test(`${provider}: getResearchCapabilities returns valid shape`, () => {
      const caps = getResearchCapabilities(provider)
      assert.ok(typeof caps.context7 === 'boolean', `${provider}: context7 must be boolean`)
      assert.ok(
        typeof caps.mintlifyIndex === 'boolean',
        `${provider}: mintlifyIndex must be boolean`
      )
      assert.ok(typeof caps.webSearch === 'boolean', `${provider}: webSearch must be boolean`)
    })

    test(`${provider}: buildCapabilityHints produces non-empty string`, () => {
      const hints = buildCapabilityHints(provider)
      assert.ok(hints.length > 0, `${provider}: must produce non-empty hints`)
      assert.ok(hints.includes('Context7'), `${provider}: must mention Context7`)
      assert.ok(
        hints.includes('Mintlify Index') || hints.includes('Mintlify'),
        `${provider}: must mention Mintlify Index`
      )
      assert.ok(
        hints.includes('Web search') || hints.includes('web search'),
        `${provider}: must mention web search`
      )
    })
  }
})

// ─── research-policy — opencode has Mintlify Index enabled ──────────────

describe('research-policy — opencode has Mintlify Index enabled', () => {
  test('opencode mintlifyIndex is true', () => {
    const caps = getResearchCapabilities('opencode')
    assert.equal(caps.mintlifyIndex, true, 'opencode must have Mintlify Index available')
  })

  test('other providers have mintlifyIndex false', () => {
    for (const provider of ['claude-code', 'codex-cli', 'grok-cli'] as const) {
      const caps = getResearchCapabilities(provider)
      assert.equal(caps.mintlifyIndex, false, `${provider} must not have Mintlify Index`)
    }
  })
})

// ─── research-policy — reviewer blocks version-incompatible API usage ──────────────

describe('research-policy — reviewer blocks version-incompatible API usage', () => {
  test('reviewer template mentions dependency-related blocks', () => {
    const reviewer = agentReviewer({ projectName: PROJECT_NAME })
    assert.ok(
      reviewer.includes('Dependency-related') || reviewer.includes('dependency-impact'),
      'must mention dependency-related blocks'
    )
    assert.ok(
      reviewer.includes('APIs unavailable') ||
        reviewer.includes('unavailable') ||
        reviewer.includes('installed version'),
      'must mention blocking unavailable APIs'
    )
  })

  test('reviewer checks dependency-impact conclusion', () => {
    const reviewer = agentReviewer({ projectName: PROJECT_NAME })
    assert.ok(
      reviewer.includes('dependency-impact') ||
        reviewer.includes('Dependency impact') ||
        reviewer.includes('dependency impact'),
      'must check dependency-impact conclusion'
    )
  })
})

// ─── research-policy — no-upgrade conclusions ──────────────

describe('research-policy — no-upgrade conclusions', () => {
  test('consultant template allows "Upgrade required: no"', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.ok(
      consultant.includes('no upgrade') ||
        consultant.includes('No upgrade') ||
        consultant.includes('NO upgrade') ||
        consultant.includes('When NO upgrade'),
      'must describe no-upgrade case'
    )
    assert.ok(
      consultant.includes('installed-version evidence') ||
        consultant.includes('installed version evidence'),
      'must cite installed-version evidence for no-upgrade'
    )
  })

  test('consultant template handles required upgrades', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.ok(
      consultant.includes('Minimum compatible version') ||
        consultant.includes('minimum compatible version'),
      'must mention minimum compatible version'
    )
    assert.ok(
      consultant.includes('breaking changes') || consultant.includes('Breaking changes'),
      'must mention breaking changes'
    )
    assert.ok(consultant.includes('migration'), 'must mention migration')
  })
})

// ─── research-policy — uncertainty handling ──────────────

describe('research-policy — uncertainty handling', () => {
  test('consultant template uses "uncertain" when evidence unavailable', () => {
    const consultant = agentConsultant({ projectName: PROJECT_NAME })
    assert.ok(consultant.includes('uncertain'), 'must use uncertain keyword')
    assert.ok(
      consultant.includes('Do not convert uncertainty') ||
        consultant.includes('do not convert uncertainty'),
      'must warn against converting uncertainty to upgrade recommendation'
    )
  })
})

// ─── research-policy — generation parity across providers ──────────────

describe('research-policy — generation parity across providers', () => {
  const providers: Array<'claude-code' | 'opencode' | 'codex-cli' | 'grok-cli'> = [
    'claude-code',
    'opencode',
    'codex-cli',
    'grok-cli',
  ]

  test('all providers have materializers that accept capability hints', () => {
    for (const provider of providers) {
      // Use a type-only reference to avoid unused variable warning
      const _typeCheck: typeof provider = provider
      void _typeCheck // used only for type verification
      const materializer = getMaterializer(provider)
      assert.ok(materializer, `${provider} materializer must exist`)
      assert.ok(
        typeof materializer.build === 'function',
        `${provider} materializer must have build method`
      )
    }
  })
})

// ─── research-policy — docs contain full policy ──────────────

describe('research-policy — docs contain full policy', () => {
  test('docs plan has terminology section', () => {
    const planDoc = readFileSync(
      join(import.meta.dirname, '../../docs/documentation-research-policy-plan.md'),
      'utf8'
    )
    assert.ok(planDoc.includes('Context7'), 'must define Context7')
    assert.ok(planDoc.includes('Mintlify Index'), 'must define Mintlify Index')
    assert.ok(planDoc.includes('Web search'), 'must define Web search')
    assert.ok(planDoc.includes('Graphify'), 'must mention Graphify')
    assert.ok(planDoc.includes('Autoskills'), 'must mention Autoskills')
  })

  test('docs index has trigger policy', () => {
    const indexDoc = readFileSync(join(import.meta.dirname, '../../docs/index.md'), 'utf8')
    assert.ok(
      indexDoc.includes('Trigger Policy') || indexDoc.includes('trigger policy'),
      'must have trigger policy section'
    )
    assert.ok(indexDoc.includes('research, search, verify, compare'), 'must list research triggers')
  })

  test('docs index has source order', () => {
    const indexDoc = readFileSync(join(import.meta.dirname, '../../docs/index.md'), 'utf8')
    assert.ok(
      indexDoc.includes('Source Order') || indexDoc.includes('source order'),
      'must have source order section'
    )
    assert.ok(
      indexDoc.includes('Current project evidence'),
      'source order starts with project evidence'
    )
    assert.ok(indexDoc.includes('Context7'), 'source order includes Context7')
    assert.ok(indexDoc.includes('Mintlify Index'), 'source order includes Mintlify Index')
  })

  test('docs index has dependency-impact conclusion template', () => {
    const indexDoc = readFileSync(join(import.meta.dirname, '../../docs/index.md'), 'utf8')
    assert.ok(
      indexDoc.includes('Dependency-Impact Conclusion') ||
        indexDoc.includes('Dependency-impact Conclusion') ||
        indexDoc.includes('dependency-impact conclusion'),
      'must have dependency-impact section'
    )
    assert.ok(indexDoc.includes('Installed version(s)'), 'template must list installed version(s)')
    assert.ok(indexDoc.includes('Compatibility'), 'template must list compatibility')
    assert.ok(indexDoc.includes('Upgrade required'), 'template must list upgrade required')
    assert.ok(
      indexDoc.includes('New dependency required'),
      'template must list new dependency required'
    )
    assert.ok(
      indexDoc.includes('Proposed version or package'),
      'template must list proposed version'
    )
    assert.ok(indexDoc.includes('Evidence'), 'template must list evidence')
  })

  test('docs plan has agent responsibilities summary', () => {
    const planDoc = readFileSync(
      join(import.meta.dirname, '../../docs/documentation-research-policy-plan.md'),
      'utf8'
    )
    assert.ok(planDoc.includes('Lead'), 'must have Lead responsibilities')
    assert.ok(planDoc.includes('Explorer'), 'must have Explorer responsibilities')
    assert.ok(planDoc.includes('Consultant'), 'must have Consultant responsibilities')
    assert.ok(planDoc.includes('Builder'), 'must have Builder responsibilities')
    assert.ok(planDoc.includes('Reviewer'), 'must have Reviewer responsibilities')
  })

  test('docs plan has tool availability and fallback', () => {
    const planDoc = readFileSync(
      join(import.meta.dirname, '../../docs/documentation-research-policy-plan.md'),
      'utf8'
    )
    assert.ok(
      planDoc.includes('Tool Availability') ||
        planDoc.includes('tool availability') ||
        planDoc.includes('fallback'),
      'must have tool availability section'
    )
    assert.ok(planDoc.includes('Never invent'), 'must prohibit inventing tool calls')
  })

  test('docs plan has context and cost control', () => {
    const planDoc = readFileSync(
      join(import.meta.dirname, '../../docs/documentation-research-policy-plan.md'),
      'utf8'
    )
    assert.ok(
      planDoc.includes('Context and cost control') || planDoc.includes('context and cost control'),
      'must have cost control section'
    )
    assert.ok(
      planDoc.includes('resolve one library once'),
      'must mention resolving one library once'
    )
    assert.ok(planDoc.includes('one concept'), 'must mention one concept per request')
  })
})

// ─── research-policy — docs/index.md updated ──────────────

describe('research-policy — docs/index.md updated', () => {
  test('docs/index.md has documentation research policy section', () => {
    const indexMd = readFileSync(join(import.meta.dirname, '../../docs/index.md'), 'utf8')
    assert.ok(
      indexMd.includes('Documentation Research Policy') ||
        indexMd.includes('documentation research policy'),
      'must have research policy section'
    )
  })

  test('docs/index.md references AGENTS.md for full detail', () => {
    const indexMd = readFileSync(join(import.meta.dirname, '../../docs/index.md'), 'utf8')
    assert.ok(
      indexMd.includes('AGENTS.md') || indexMd.includes('../AGENTS.md'),
      'must reference AGENTS.md'
    )
  })

  test('docs/index.md mentions trigger policy', () => {
    const indexMd = readFileSync(join(import.meta.dirname, '../../docs/index.md'), 'utf8')
    assert.ok(
      indexMd.includes('Trigger Policy') ||
        indexMd.includes('trigger policy') ||
        indexMd.includes('Initiate external'),
      'must mention trigger policy'
    )
  })

  test('docs/index.md mentions source order', () => {
    const indexMd = readFileSync(join(import.meta.dirname, '../../docs/index.md'), 'utf8')
    assert.ok(
      indexMd.includes('Source Order') ||
        indexMd.includes('source order') ||
        indexMd.includes('Current project evidence'),
      'must mention source order'
    )
  })

  test('docs/index.md mentions dependency-impact conclusion', () => {
    const indexMd = readFileSync(join(import.meta.dirname, '../../docs/index.md'), 'utf8')
    assert.ok(
      indexMd.includes('Dependency-Impact') ||
        indexMd.includes('dependency-impact') ||
        indexMd.includes('Dependency impact'),
      'must mention dependency-impact conclusion'
    )
  })
})
