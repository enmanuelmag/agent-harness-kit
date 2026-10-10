import { spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

export type HealthCheckState = 'ready' | 'missing' | 'placeholder' | 'incompatible'

export function getDefaultHealthScriptPath(
  platform = process.platform
): './health.sh' | './health.bat' {
  return platform === 'win32' ? './health.bat' : './health.sh'
}

export function isDefaultHealthScriptPath(path: string): boolean {
  return (
    path.replace(/\\/g, '/').replace(/^\.\//, '') === 'health.sh' ||
    path.replace(/\\/g, '/').replace(/^\.\//, '') === 'health.bat'
  )
}

export interface HealthCheckInspection {
  path: string
  state: HealthCheckState
  adaptFrom?: string
  message?: string
}

/** Identifies scaffold placeholders without treating a real script that merely
 * mentions fixtures as a placeholder. Historical scaffolds had only echo/exit
 * statements, so the fallback is intentionally restricted to that shape. */
export function isHealthPlaceholder(content: string): boolean {
  if (/AHK_HEALTH_CHECK_PLACEHOLDER/i.test(content)) return true
  const executable = content
    .replace(/^\s*(#|REM\b).*$/gim, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const echoLines = executable.filter((line) => /^(echo\b|@echo\b)/i.test(line))
  const scaffoldShape = executable.every((line) =>
    /^(echo\b|@echo\b|exit\b|@exit\b|setlocal\b|endlocal\b|set\b|if\b|for\b|tail\b|type\b|call\s+:|:\w+|\{|\}|status=|LOG_FILE=|\[|fi\b)/i.test(
      line
    )
  )
  return (
    scaffoldShape &&
    echoLines.some((line) =>
      /(?:health\.(?:sh|bat).*not implemented|dummy\s+content|placeholder)/i.test(line)
    )
  )
}

export function inspectHealthCheck(
  cwd: string,
  configuredPath: string,
  platform = process.platform
): HealthCheckInspection {
  const nativePath = getDefaultHealthScriptPath(platform)
  const selected = isDefaultHealthScriptPath(configuredPath) ? nativePath : configuredPath
  const normalized = selected.replace(/\\/g, '/').toLowerCase()
  const wantsBat = normalized.endsWith('.bat')
  const wantsShell = normalized.endsWith('.sh')
  if ((platform === 'win32' && wantsShell) || (platform !== 'win32' && wantsBat)) {
    return {
      path: resolve(cwd, selected),
      state: 'incompatible',
      message: `${selected} is not native to this platform`,
    }
  }
  const path = resolve(cwd, selected)
  if (!existsSync(path)) {
    const opposite = resolve(cwd, platform === 'win32' ? './health.sh' : './health.bat')
    return { path, state: 'missing', ...(existsSync(opposite) ? { adaptFrom: opposite } : {}) }
  }
  // Dynamic import avoids a read for missing paths and keeps this helper pure-ish.
  const content = readFileSync(path, 'utf8')
  return { path, state: isHealthPlaceholder(content) ? 'placeholder' : 'ready' }
}

export interface HealthExecutionResult {
  status: number | null
  signal: NodeJS.Signals | null
  error?: Error
  logPath: string
  tail: string
}

export function tailFile(path: string, lines: number): string {
  const size = statSync(path).size
  if (size === 0) return ''
  const fd = openSync(path, 'r')
  try {
    let position = size
    let chunks = ''
    let newlines = 0
    while (position > 0 && newlines <= lines) {
      const length = Math.min(64 * 1024, position)
      position -= length
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, position)
      const text = buffer.toString('utf8')
      chunks = text + chunks
      newlines += (text.match(/\n/g) ?? []).length
    }
    const rows = chunks.replace(/\r/g, '').split('\n')
    if (rows.at(-1) === '') rows.pop()
    return rows.slice(-lines).join('\n')
  } finally {
    closeSync(fd)
  }
}

export function executeHealthCheck(
  cwd: string,
  scriptPath: string,
  platform = process.platform
): HealthExecutionResult {
  const logDir = mkdtempSync(join(tmpdir(), 'ahk-health-'))
  const logPath = join(logDir, `${basename(scriptPath)}.log`)
  const fd = openSync(logPath, 'w')
  const command = platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'bash'
  const args =
    platform === 'win32'
      ? ['/d', '/v:off', '/s', '/c', `call "${scriptPath.replace(/"/g, '""')}"`]
      : [scriptPath]
  let result: ReturnType<typeof spawnSync>
  try {
    result = spawnSync(command, args, { cwd, stdio: ['ignore', fd, fd] })
  } finally {
    closeSync(fd)
  }
  const status = result.status
  return {
    status,
    signal: result.signal,
    error: result.error,
    logPath,
    tail: tailFile(logPath, status === 0 ? 10 : 100),
  }
}
