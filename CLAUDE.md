# claude-tools

A Claude Code marketplace (`.claude-plugin/marketplace.json`) hosting mods (`mods/`) and classic plugins (`plugins/`). See README.md for the layout.

## Adding an entry

- Scaffold with `node scripts/new.mjs <mod|plugin> <kebab-name> "description"`; it copies `templates/<kind>/` and adds the marketplace entry. Don't hand-copy a template.
- A mod is a function-hooks plugin: `hooks/hooks.json` names one module under `modules`, exporting `register` typed from `'claude-code'`. Use the `plugin-authoring` skill when writing one; the API changes between releases, so read the declarations rather than relying on memory.
- A classic plugin uses `commands/*.md`, `skills/<name>/SKILL.md`, `agents/*.md`, `hooks/hooks.json` (`{ "hooks": { ... } }`), and `.mcp.json`.
- Keep the plugin's `name` in `plugin.json`, its folder name, and its marketplace entry identical. Bump `version` in both `plugin.json` and the marketplace entry when changing a published entry.
- Add a row to the README catalog for each new entry.

## Checks

Run `scripts/validate.sh` before committing: it runs `claude plugin validate` on the marketplace and each entry, and `claude plugin test` on each mod with `*.test.ts` files. Every mod should have at least one test.

Never commit `.claude-plugin/types/` (engine-generated, git-ignored), secrets, or logs.
