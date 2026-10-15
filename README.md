# claude-tools

A [Claude Code](https://claude.com/claude-code) marketplace of mods and plugins.

- **Mods** (`mods/`) change Claude Code's own interface or behaviour through a TypeScript hooks module: panes, status line entries, toasts, slash commands, and hooks on tool calls or prompts.
- **Plugins** (`plugins/`) bundle classic extensions: slash commands, skills, subagents, command hooks, and MCP servers.

Both kinds are listed in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) and install the same way.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install <name> --marketplace claudezss/claude-tools
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```sh
claude plugin install <name> --marketplace claudezss/claude-tools
```

In the desktop app, click **+** next to the prompt box, then **Plugins** → **Add marketplace** with `claudezss/claude-tools`, then **Add plugin**.

## Catalog

| Name | Kind | Description |
| --- | --- | --- |
| _none yet_ | | |

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace: one entry per mod or plugin
mods/<name>/                      function-hook mods
  .claude-plugin/plugin.json
  hooks/hooks.json                { "modules": ["./register.ts"] }
  hooks/register.ts               export const register: Register = on => { ... }
  hooks/*.test.ts                 run with `claude plugin test`
plugins/<name>/                   classic plugins
  .claude-plugin/plugin.json
  commands/  skills/  agents/  hooks/hooks.json  .mcp.json
templates/                        what scripts/new.mjs copies
scripts/
  new.mjs                         scaffold a mod or plugin and list it
  validate.sh                     validate everything, run mod tests
```

## Development

Create a new mod or plugin (copies the template, fills in the name, adds the marketplace entry):

```sh
node scripts/new.mjs mod my-mod "One-line description"
node scripts/new.mjs plugin my-plugin "One-line description"
```

Try it from disk without installing; an interactive session reloads it on save:

```sh
claude --plugin-dir mods/my-mod
```

Or add this checkout as a marketplace, so installed entries are read straight from the folder (`/reload-plugins` picks up edits):

```sh
claude plugin marketplace add .
claude plugin install my-mod@claude-tools
```

Before committing, validate the marketplace and every entry, and run the mods' tests:

```sh
scripts/validate.sh
```

The mod API's TypeScript declarations are written by the engine into `<mod>/.claude-plugin/types/` the first time it loads the mod (git-ignored); with them in place, `tsc -p mods/my-mod` type-checks it. The mod API is early access and may change between Claude Code releases.

## License

[Apache 2.0](LICENSE)
