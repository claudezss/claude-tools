#!/usr/bin/env node
// Scaffold a new mod or plugin from templates/ and list it in the marketplace.
//
//   node scripts/new.mjs mod <name> ["one-line description"]
//   node scripts/new.mjs plugin <name> ["one-line description"]

import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKETPLACE = join(ROOT, '.claude-plugin', 'marketplace.json')
const FOLDERS = { mod: 'mods', plugin: 'plugins' }

const [kind, name, description = `The ${name} ${kind}`] = process.argv.slice(2)

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!FOLDERS[kind] || !name) fail('usage: node scripts/new.mjs <mod|plugin> <name> ["description"]')
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(`name must be kebab-case: ${name}`)

const marketplace = JSON.parse(readFileSync(MARKETPLACE, 'utf8'))
if (marketplace.plugins.some(p => p.name === name)) fail(`${name} is already in the marketplace`)

const relative = `${FOLDERS[kind]}/${name}`
const target = join(ROOT, relative)
if (existsSync(target)) fail(`${relative} already exists`)

cpSync(join(ROOT, 'templates', kind), target, { recursive: true })

const fill = text => text.replaceAll('__NAME__', name).replaceAll('__DESCRIPTION__', description)

// Depth-first so a renamed folder's children are handled before the folder itself.
function substitute(dir) {
  for (const entry of readdirSync(dir)) {
    let path = join(dir, entry)
    if (entry.includes('__NAME__')) {
      const renamed = join(dir, fill(entry))
      renameSync(path, renamed)
      path = renamed
    }
    if (statSync(path).isDirectory()) substitute(path)
    else writeFileSync(path, fill(readFileSync(path, 'utf8')))
  }
}
substitute(target)

marketplace.plugins.push({
  name,
  source: `./${relative}`,
  description,
  version: '0.1.0',
  category: kind,
})
marketplace.plugins.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(MARKETPLACE, `${JSON.stringify(marketplace, null, 2)}\n`)

console.log(`Created ${relative} and listed it in .claude-plugin/marketplace.json`)
console.log(`Validate with: claude plugin validate ${relative}`)
