#!/usr/bin/env node
// Scaffold a new mod or plugin from templates/ and list it in the marketplace.
//
//   node scripts/new.mjs mod <name> ["one-line description"]
//   node scripts/new.mjs plugin <name> ["one-line description"]

import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MARKETPLACE = join(ROOT, '.claude-plugin', 'marketplace.json')
const FOLDERS = { mod: 'mods', plugin: 'plugins' }
const TEXT = new Set(['.json', '.md', '.ts', '.tsx', '.js', '.mjs'])

const [kind, name, description = `The ${name} ${kind}`] = process.argv.slice(2)

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!Object.hasOwn(FOLDERS, kind) || !name) fail('usage: node scripts/new.mjs <mod|plugin> <name> ["description"]')
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(`name must be kebab-case: ${name}`)
if (/[\r\n]/.test(description)) fail('description must be one line')

const marketplace = JSON.parse(readFileSync(MARKETPLACE, 'utf8'))
if (marketplace.plugins.some(p => p.name === name)) fail(`${name} is already in the marketplace`)
for (const folder of Object.values(FOLDERS)) {
  if (existsSync(join(ROOT, folder, name))) fail(`${folder}/${name} already exists`)
}

const relative = `${FOLDERS[kind]}/${name}`
const target = join(ROOT, relative)

// Templates write the description as "__DESCRIPTION__", quotes included, so a
// JSON string literal stands in for it: valid in JSON, YAML and TypeScript alike.
const fill = text =>
  text.replaceAll('"__DESCRIPTION__"', () => JSON.stringify(description)).replaceAll('__NAME__', () => name)

// Renames a folder before descending into it, so its children are found under the new name.
function substitute(dir) {
  for (const entry of readdirSync(dir)) {
    let path = join(dir, entry)
    if (entry.includes('__NAME__')) {
      const renamed = join(dir, fill(entry))
      renameSync(path, renamed)
      path = renamed
    }
    if (statSync(path).isDirectory()) substitute(path)
    else if (TEXT.has(extname(path))) writeFileSync(path, fill(readFileSync(path, 'utf8')))
  }
}

try {
  cpSync(join(ROOT, 'templates', kind), target, { recursive: true })
  substitute(target)
} catch (error) {
  rmSync(target, { recursive: true, force: true })
  throw error
}

// The version lives in plugin.json alone, so the two can't drift.
marketplace.plugins.push({ name, source: `./${relative}`, description, category: kind })
marketplace.plugins.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(MARKETPLACE, `${JSON.stringify(marketplace, null, 2)}\n`)

console.log(`Created ${relative} and listed it in .claude-plugin/marketplace.json`)
console.log('Validate with: node scripts/validate.mjs')
