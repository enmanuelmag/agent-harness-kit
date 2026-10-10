import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function releaseMetadata(version, branch) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.exec(version)
  if (!match) throw new Error(`Unsupported release version: ${version}`)
  const major = Number(match[1])
  const prerelease = match[4] !== undefined
  if (branch === 'release/v2') {
    if (major !== 2 || prerelease) throw new Error('release/v2 requires a stable 2.x version')
  } else if (branch === 'main' || branch === 'release/v3') {
    if (major !== 3) throw new Error(`${branch} requires a 3.x version`)
  } else {
    throw new Error(`Releases require main, release/v2 or release/v3; received ${branch}`)
  }
  return {
    version,
    tag: `v${version}`,
    channel: prerelease ? 'rc' : branch === 'release/v2' ? 'v2' : 'latest',
    prerelease,
  }
}

export function preparedTagAtHead(cwd, tag) {
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    git('show-ref', '--verify', '--quiet', `refs/tags/${tag}`)
  } catch (error) {
    if (error.status === 1) return false
    throw error
  }
  if (git('rev-parse', `${tag}^{}`) !== git('rev-parse', 'HEAD')) {
    throw new Error(`Tag ${tag} already exists at another commit; tags must not be moved`)
  }
  return true
}

export function currentRelease(cwd = process.cwd(), branch) {
  const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
  const currentBranch =
    branch ?? execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim()
  const metadata = releaseMetadata(manifest.version, currentBranch)
  return { ...metadata, name: manifest.name, preparedTag: preparedTagAtHead(cwd, metadata.tag) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const field = process.argv[2]
    const metadata = currentRelease(
      process.cwd(),
      field === 'github' ? process.env.RELEASE_BRANCH : undefined
    )
    if (field === 'github') {
      for (const [key, value] of Object.entries(metadata)) console.log(`${key}=${value}`)
    } else if (field) {
      if (!(field in metadata)) throw new Error(`Unknown release metadata field: ${field}`)
      process.stdout.write(`${String(metadata[field])}\n`)
    } else {
      console.log(JSON.stringify(metadata))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
