import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAINTENANCE_TOOLS } from '../core/maintenance-tools'
import { codexRestrictionNotice,maintenanceOperationsFor } from '../core/materializer/agent-restrictions'
import { MCP_CLAUDE_PERMISSIONS_BUILDER, MCP_CLAUDE_PERMISSIONS_CONSULTANT, MCP_CLAUDE_PERMISSIONS_EXPLORER, MCP_CLAUDE_PERMISSIONS_LEAD, MCP_CLAUDE_PERMISSIONS_REVIEWER } from '../core/materializer/mcp-merge'

test('generated maintenance defaults permit diagnostics to every role and explicit mutations to lead/builder',()=>{
  const nativeName=(name:string)=>`mcp__agent-harness-kit__${name.replaceAll('.','_')}`
  for(const permissions of [MCP_CLAUDE_PERMISSIONS_LEAD,MCP_CLAUDE_PERMISSIONS_BUILDER]) for(const tool of MAINTENANCE_TOOLS) assert.ok(permissions.includes(nativeName(tool.name)),tool.name)
  for(const [role,permissions] of [['explorer',MCP_CLAUDE_PERMISSIONS_EXPLORER],['consultant',MCP_CLAUDE_PERMISSIONS_CONSULTANT],['reviewer',MCP_CLAUDE_PERMISSIONS_REVIEWER]] as const) {
    for(const operation of ['ahk.capabilities','ahk.status','ahk.sync.plan','ahk.reset.plan','ahk.notifications.status','ahk.health','ahk.notify.attention']) assert.ok(permissions.includes(nativeName(operation)),`${role}:${operation}`)
    for(const operation of ['ahk.sync.apply','ahk.init','ahk.reset.apply','ahk.notifications.enable','ahk.notifications.install','ahk.dashboard.start','ahk.export']) {
      assert.equal(permissions.includes(nativeName(operation)),false,`${role}:${operation}`)
      assert.equal(maintenanceOperationsFor(role).includes(operation),false)
    }
    assert.match(codexRestrictionNotice(role),/separate from direct project edits/)
  }
})
