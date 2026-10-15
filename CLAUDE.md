# claude-tools

A Claude Code marketplace (`.claude-plugin/marketplace.json`) hosting mods (`mods/`) and classic plugins (`plugins/`). See README.md for the layout.

## Adding an entry

- Scaffold with `node scripts/new.mjs <mod|plugin> <kebab-name> "description"`; it copies `templates/<kind>/` and adds the marketplace entry. Don't hand-copy a template.
- A mod is a function-hooks plugin: `hooks/hooks.json` names one module under `modules`, exporting `register` typed from `'claude-code'`. Use the `plugin-authoring` skill when writing one; the API changes between releases, so read the declarations rather than relying on memory.
- A classic plugin uses `skills/<name>/SKILL.md` (preferred over legacy `commands/*.md`), `agents/*.md`, `hooks/hooks.json` (`{ "hooks": { ... } }`), and `.mcp.json`.
- Keep the plugin's `name` in `plugin.json`, its folder name, and its marketplace entry identical. `version` lives only in `plugin.json`; bump it when changing a published entry and don't add one to the marketplace entry.
- Add a row to the README catalog for each new entry.

## Checks

Run `node scripts/validate.mjs` before committing. It runs `claude plugin validate` on the marketplace and `--strict` on each entry, checks that every marketplace entry has a matching folder and name (and every folder an entry), and runs `claude plugin test` on each mod. A mod without a `*.test.ts` file fails.

Never commit `.claude-plugin/types/` (engine-generated, git-ignored), secrets, or logs.
