import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync,mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

import { applyConfigDefaults } from '../commands/init-helpers'
import { loadConfig } from '../core/config'
import { openDB } from '../core/db'
import { updateManagedConfig } from '../core/maintenance/config'
import { MaintenanceService } from '../core/maintenance/operations'
import { MAINTENANCE_TOOLS } from '../core/maintenance-tools'
import { createMcpServer } from '../core/mcp-server'
import { recordNotificationEvent } from '../core/notifications/marker'
import { NotificationService } from '../core/notifications/runtime'
import { ok } from '../core/result'
import { withSQLiteMaintenance } from '../core/sqlite-ownership'

test('actual SDK exposes complete maintenance contracts, setup and typed safe errors without CLI subprocesses', async (t) => {
  const cwd = mkdtempSync(join(process.cwd(), '.tmp-maintenance-mcp-'))
  const server = createMcpServer(undefined, cwd, undefined, undefined, {homeDir:join(cwd,'.fake-home')})
  const client = new Client({ name: 'maintenance-parity-test', version: '1' })
  const [a,b] = InMemoryTransport.createLinkedPair()
  const call = async(name:string,args:Record<string,unknown>={}) => client.callTool({name,arguments:args})
  const dto = (result: Awaited<ReturnType<typeof call>>) => result.structuredContent as {ok:boolean; code:string; data?:Record<string,unknown>}
  try {
    await server.connect(b); await client.connect(a)
    const tools=await client.listTools()
    for(const tool of MAINTENANCE_TOOLS) {
      const actual=tools.tools.find(item=>item.name===tool.name)
      assert.ok(actual,tool.name); assert.ok(actual.outputSchema,tool.name)
    }
    assert.equal(dto(await call('ahk.serve')).code,'already_running')
    const uninitialized=await call('tasks.get')
    assert.equal(uninitialized.isError,true)
    assert.match(JSON.stringify(uninitialized.content),/not_initialized/)
    const invalid=await call('ahk.notifications.configure',{scope:'project',patch:{enabled:'false'}})
    assert.equal(invalid.isError,true); assert.equal(dto(invalid).ok,false)
    assert.equal(existsSync(join(cwd,'agent-harness-kit.config.local.json')),false)
    const unknown=await call('ahk.notifications.configure',{scope:'project',patch:{enabled:false,unused:'strip'},unused:'strip'})
    assert.equal(unknown.isError,false); assert.equal(dto(unknown).ok,true)
    const overlay=JSON.parse(readFileSync(join(cwd,'agent-harness-kit.config.local.json'),'utf8'))
    assert.deepEqual(overlay.notifications,{enabled:false})
    const rejectedForce=await call('ahk.sync.plan',{force:'false'})
    assert.equal(rejectedForce.isError,true)
    assert.equal(dto(rejectedForce).ok,false)
    const initialized=await call('ahk.init',{name:'Parity fixture',description:'Isolated setup',provider:'grok-cli',docs:'docs',storageScope:'local',notifications:false,installHooks:false})
    assert.equal(initialized.isError,false,JSON.stringify(initialized.content))
    assert.equal(dto(initialized).ok,true)
    writeFileSync(join(cwd,'health.sh'),'#!/bin/sh\nexit 0\n',{mode:0o755})
    const configFile=join(cwd,'agent-harness-kit.config.json')
    const config=JSON.parse(readFileSync(configFile,'utf8'))
    config.health={required:true,scriptPath:'./health.sh'}
    writeFileSync(configFile,JSON.stringify(config))
    const published: string[]=[]
    t.mock.method(NotificationService.prototype,'publish',function(this:NotificationService,kind:Parameters<NotificationService['publish']>[0]) {
      if(!this.settings.enabled||!this.settings.categories[kind]) return ok(undefined)
      published.push(kind)
      const event={id:randomUUID(),kind,projectKey:this.projectKey,eventKey:`fake-${published.length}`,status:'pending' as const,createdAt:Date.now(),isNew:true}
      recordNotificationEvent(event)
      return ok(event)
    })
    t.mock.method(NotificationService.prototype,'recovered',()=>undefined)
    assert.equal(dto(await call('ahk.notifications.enable',{scope:'project'})).ok,true)
    const added=await call('tasks.add',{title:'Same-session task'})
    assert.equal(added.isError,false,JSON.stringify(added.content))
    const task=added.structuredContent as {id:number;slug:string}
    const edited=await call('tasks.edit',{id:task.slug,title:'Resolved slug'})
    assert.equal(edited.isError,false,JSON.stringify(edited.content))
    await call('tasks.claim',{id:task.id,agent:'lead'})
    const completed=await call('tasks.update',{id:task.slug,status:'done'})
    assert.equal(completed.isError,false,JSON.stringify(completed.content))
    assert.deepEqual(published,['task.completed'])
    assert.match(JSON.stringify(completed.content),/notificationSchemaVersion/)
    await call('tasks.archive',{id:task.id})
    const archived=await call('tasks.get',{archivedOnly:true})
    assert.equal((archived.structuredContent as {items:unknown[]}).items.length,1)
    const disabled=await call('ahk.notifications.disable',{scope:'project'})
    assert.equal(dto(disabled).ok,true)
    const another=await call('tasks.add',{title:'Disabled completion'})
    const anotherId=(another.structuredContent as {id:number}).id
    await call('tasks.claim',{id:anotherId,agent:'lead'})
    const silent=await call('tasks.update',{id:anotherId,status:'done'})
    assert.equal(silent.isError,false,JSON.stringify(silent.content))
    assert.doesNotMatch(JSON.stringify(silent.content),/notificationSchemaVersion/)
    assert.equal(published.length,1)
    const state=await call('ahk.notifications.status')
    assert.equal(dto(state).ok,true)
    const hooks=await call('ahk.notifications.install',{provider:'cursor'})
    assert.equal(dto(hooks).ok,true,JSON.stringify(hooks.content))
    assert.ok(existsSync(join(cwd,'.cursor/hooks.json')))
    const uninstalled=await call('ahk.notifications.uninstall',{provider:'cursor'})
    assert.equal(dto(uninstalled).ok,true,JSON.stringify(uninstalled.content))
    assert.equal(dto(await call('ahk.notifications.enable',{scope:'global'})).ok,true)
    const precedence=await call('ahk.notifications.status')
    assert.equal((dto(precedence).data?.effective as {enabled:boolean}).enabled,false)
    assert.equal(dto(precedence).data?.globalEnabledOverridden,true)
    const sync=await call('ahk.sync.plan')
    assert.equal(dto(sync).ok,true,JSON.stringify(sync.content))
    const applied=await call('ahk.sync.apply',{planId:dto(sync).data?.planId})
    assert.equal(dto(applied).ok,true,JSON.stringify(applied.content))
    const status=await call('ahk.status',{limit:'1'})
    assert.equal(dto(status).ok,true,JSON.stringify(status.content))
    const beforeModelsConfig=readFileSync(configFile)
    const beforeModelsOverlay=readFileSync(join(cwd,'agent-harness-kit.config.local.json'))
    const modelMismatch=await call('ahk.models',{provider:'codex-cli',choices:Object.fromEntries(['lead','explorer','consultant','builder','reviewer'].map(role=>[role,{model:'inherit'}]))})
    assert.equal(modelMismatch.isError,true)
    assert.equal(dto(modelMismatch).code,'provider_mismatch')
    assert.equal(dto(modelMismatch).data?.currentProvider,'grok-cli')
    assert.deepEqual(readFileSync(configFile),beforeModelsConfig)
    assert.deepEqual(readFileSync(join(cwd,'agent-harness-kit.config.local.json')),beforeModelsOverlay)
    const exported=await call('ahk.export',{format:'json'})
    assert.equal(dto(exported).ok,true,JSON.stringify(exported.content))
    const exportPath=String(dto(exported).data?.path)
    const beforeExport=readFileSync(exportPath)
    const overwriteDenied=await call('ahk.export',{format:'json',output:exportPath})
    assert.equal(dto(overwriteDenied).code,'output_exists')
    assert.deepEqual(readFileSync(exportPath),beforeExport)
    const unsafeForce=await call('ahk.export',{format:'json',output:exportPath,force:'false'})
    assert.equal(dto(unsafeForce).ok,false)
    assert.deepEqual(readFileSync(exportPath),beforeExport)
    const overwritten=await call('ahk.export',{format:'json',output:exportPath,force:true})
    assert.equal(dto(overwritten).ok,true,JSON.stringify(overwritten.content))
    assert.ok(existsSync(String(dto(overwritten).data?.backupDir)))
    assert.equal(dto(await call('ahk.sync.apply',{planId:'missing'})).ok,false)
    const start=await call('ahk.watch.start')
    assert.equal(dto(start).ok,true,JSON.stringify(start.content))
    assert.equal(dto(await call('ahk.watch.stop')).ok,true)
    const dashboard=await call('ahk.dashboard.start',{port:4422,open:false})
    assert.equal(dto(dashboard).ok,true,JSON.stringify(dashboard.content))
    assert.equal(dto(await call('ahk.dashboard.stop')).ok,true)
    const missing=await call('ahk.reset.apply',{planId:'missing',confirm:true})
    assert.equal(dto(missing).ok,false)
    const invalidOutput=t.mock.method(MaintenanceService.prototype,'execute',async()=>({ok:true,operation:'status',code:'ok',data:{tasks:'wrong'}}))
    const outputFailure=await call('ahk.status')
    assert.equal(outputFailure.isError,true)
    assert.equal(dto(outputFailure).code,'invalid_output')
    invalidOutput.mock.restore()
    const storagePlan=await call('ahk.migrate.storage.plan',{scope:'global'})
    assert.equal(dto(storagePlan).ok,true,JSON.stringify(storagePlan.content))
    const storageApply=await call('ahk.migrate.storage.apply',{planId:dto(storagePlan).data?.planId})
    assert.equal(dto(storageApply).ok,true,JSON.stringify(storageApply.content))
    const migratedTasks=await call('tasks.get')
    assert.equal((migratedTasks.structuredContent as {items:unknown[]}).items.length,1)
    const resetPlan=await call('ahk.reset.plan',{db:true,force:true})
    assert.equal(dto(resetPlan).ok,true,JSON.stringify(resetPlan.content))
    const resetApply=await call('ahk.reset.apply',{planId:dto(resetPlan).data?.planId})
    assert.equal(dto(resetApply).ok,true,JSON.stringify(resetApply.content))
    assert.equal((await call('tasks.get')).isError,false)
    assert.equal(((await call('tasks.get')).structuredContent as {items:unknown[]}).items.length,0)
  } finally { await client.close(); await server.close(); rmSync(cwd,{recursive:true,force:true}) }
})

test('invalid executable or JSON config is not silently accepted as empty bootstrap configuration',async()=>{
  const cwd=mkdtempSync(join(process.cwd(),'.tmp-maintenance-invalid-'))
  try {
    writeFileSync(join(cwd,'agent-harness-kit.config.json'),'{invalid')
    const { loadConfig }=await import('../core/config')
    await assert.rejects(()=>loadConfig(cwd),/not valid JSON/)
    const startup=spawnSync(process.execPath,['--import','tsx/esm',join(process.cwd(),'src/cli.ts'),'serve'],{cwd,encoding:'utf8',timeout:5000})
    assert.equal(startup.status,1,startup.stderr)
    assert.match(startup.stderr,/not valid JSON/)
    assert.equal(startup.stdout,'')
    assert.equal(existsSync(join(cwd,'.harness/harness.db')),false)
  } finally {rmSync(cwd,{recursive:true,force:true})}
})

test('actual stdio startup keeps maintenance tools available while a valid SQLite DB is exclusively busy and recovers without restart',async()=>{
  const cwd=mkdtempSync(join(process.cwd(),'.tmp-maintenance-startup-'))
  const config=applyConfigDefaults({name:'Busy startup',description:'Safe maintenance bootstrap',provider:'grok-cli',docsPath:'docs',scope:'local'})
  config.notifications={enabled:false}
  writeFileSync(join(cwd,'agent-harness-kit.config.json'),JSON.stringify(config))
  const db=await openDB(config,cwd)
  await db.addTask({slug:'survives-busy',title:'Existing DB data'})
  await db.close()
  const client=new Client({name:'busy-startup-contract',version:'1'})
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx/esm',join(process.cwd(),'src/cli.ts'),'serve'],cwd,stderr:'pipe'})
  const call=async(name:string,args:Record<string,unknown>={})=>client.callTool({name,arguments:args})
  const body=(result:Awaited<ReturnType<typeof call>>)=>result.structuredContent as {code?:string;data:{mode?:string;planId?:string}}
  try {
    await withSQLiteMaintenance([join(cwd,'.harness/harness.db')],async()=>{
      await client.connect(transport)
      assert.ok((await client.listTools()).tools.some(tool=>tool.name==='ahk.sync.plan'))
      const business=await call('tasks.get')
      assert.equal(business.isError,true)
      assert.equal(body(business).code,'database_busy')
      const runtime=await call('ahk.serve')
      assert.equal(body(runtime).data.mode,'maintenance')
      assert.equal((await call('specs.list')).isError,false)
      const settings=await call('ahk.notifications.disable',{scope:'project'})
      assert.equal(settings.isError,false,JSON.stringify(settings.content))
    })
    const plan=await call('ahk.sync.plan')
    assert.equal(plan.isError,false,JSON.stringify(plan.content))
    const applied=await call('ahk.sync.apply',{planId:body(plan).data.planId})
    assert.equal(applied.isError,false,JSON.stringify(applied.content))
    const business=await call('tasks.get')
    assert.equal(business.isError,false,JSON.stringify(business.content))
    assert.equal((business.structuredContent as {items:{slug:string}[]}).items[0].slug,'survives-busy')
    assert.equal(body(await call('ahk.serve')).data.mode,'normal')
  } finally {await client.close();await transport.close();rmSync(cwd,{recursive:true,force:true})}
})

test('real SDK retired-source maintenance mode reconciles an already-current target and reopens the verified DB',async()=>{
  const cwd=mkdtempSync(join(process.cwd(),'.tmp-maintenance-retired-'))
  const homeDir=join(cwd,'.fake-home')
  const config=applyConfigDefaults({name:'Retired startup',description:'Safe current-target reconciliation',provider:'grok-cli',docsPath:'docs',scope:'local'})
  config.notifications={enabled:false}
  writeFileSync(join(cwd,'agent-harness-kit.config.json'),JSON.stringify(config))
  const db=await openDB(config,cwd,homeDir)
  await db.addTask({slug:'verified-target-data',title:'Retained migration data'})
  await db.writeStorageState(cwd)
  await db.close()
  const service=new MaintenanceService(cwd,{homeDir})
  const plan=await service.execute('migrate.storage.plan',{scope:'global'})
  const moved=await service.execute('migrate.storage.apply',{planId:plan.data!.planId})
  assert.equal(moved.ok,true,moved.message)
  await service.dispose()
  assert.equal((await updateManagedConfig(cwd,{storage:{scope:'local'}})).ok,true)
  const staleConfig=await loadConfig(cwd)
  let reason=''
  try {const invalid=await openDB(staleConfig,cwd,homeDir);await invalid.close();assert.fail('retired source must reject a normal writable open')}
  catch(cause){reason=cause instanceof Error?cause.message:String(cause)}
  assert.match(reason,/^restart_required:/)
  const server=createMcpServer(staleConfig,cwd,undefined,undefined,{homeDir,initialDatabaseError:{code:'restart_required',message:reason}})
  const client=new Client({name:'retired-startup-contract',version:'1'})
  const [a,b]=InMemoryTransport.createLinkedPair()
  const call=async(name:string,args:Record<string,unknown>={})=>client.callTool({name,arguments:args})
  const body=(result:Awaited<ReturnType<typeof call>>)=>result.structuredContent as {code?:string;data:{mode?:string;planId?:string;alreadyCurrent?:boolean;configReconciled?:boolean}}
  try {
    await server.connect(b);await client.connect(a)
    assert.equal(body(await call('tasks.get')).code,'restart_required')
    const reconcile=await call('ahk.migrate.storage.plan',{scope:'global'})
    assert.equal(reconcile.isError,false,JSON.stringify(reconcile.content))
    const applied=await call('ahk.migrate.storage.apply',{planId:body(reconcile).data.planId})
    assert.equal(applied.isError,false,JSON.stringify(applied.content))
    assert.equal(body(applied).data.alreadyCurrent,true)
    assert.equal(body(applied).data.configReconciled,true)
    const tasks=await call('tasks.get')
    assert.equal(tasks.isError,false,JSON.stringify(tasks.content))
    assert.equal((tasks.structuredContent as {items:{slug:string}[]}).items[0].slug,'verified-target-data')
    assert.equal((await loadConfig(cwd)).storage.scope,'global')
    assert.equal(body(await call('ahk.serve')).data.mode,'normal')
  } finally {await client.close();await server.close();rmSync(cwd,{recursive:true,force:true})}
})
