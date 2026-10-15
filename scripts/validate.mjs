#!/usr/bin/env node
// Validate the marketplace and every mod/plugin, check that marketplace
// entries and folders agree, and run each mod's tests.
//
//   node scripts/validate.mjs

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FOLDERS = ['mods', 'plugins']

const problems = []

function claude(...args) {
  console.log(`\n$ claude ${args.join(' ')}`)
  const { status } = spawnSync('claude', args, { cwd: ROOT, stdio: 'inherit' })
  if (status !== 0) problems.push(`claude ${args.join(' ')} exited ${status}`)
}

function hasTests(dir) {
  return readdirSync(dir, { recursive: true }).some(
    path => /\.test\.tsx?$/.test(path) && !path.split(/[\\/]/).includes('node_modules'),
  )
}

// The root may warn while the marketplace is empty, so it is not --strict.
claude('plugin', 'validate', '.')

const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
const listed = new Set()

for (const entry of marketplace.plugins) {
  const dir = join(ROOT, entry.source)
  const where = relative(ROOT, dir)
  listed.add(where)

  if (!FOLDERS.some(folder => where.startsWith(`${folder}/`))) {
    problems.push(`${entry.name}: source ${entry.source} is not under mods/ or plugins/`)
    continue
  }
  if (!existsSync(dir)) {
    problems.push(`${entry.name}: source ${entry.source} does not exist`)
    continue
  }

  const manifest = join(dir, '.claude-plugin', 'plugin.json')
  const name = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).name : undefined
  if (name !== entry.name) problems.push(`${entry.name}: ${where}/.claude-plugin/plugin.json has name ${name}`)
  if (where.split('/')[1] !== entry.name) problems.push(`${entry.name}: folder is named ${where}`)
}

for (const folder of FOLDERS) {
  for (const entry of readdirSync(join(ROOT, folder), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const where = `${folder}/${entry.name}`
    if (!listed.has(where)) problems.push(`${where} is not listed in .claude-plugin/marketplace.json`)

    claude('plugin', 'validate', '--strict', where)
    if (folder === 'mods') {
      if (hasTests(join(ROOT, where))) claude('plugin', 'test', where)
      else problems.push(`${where} has no *.test.ts files`)
    }
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('\nAll checks passed.')
