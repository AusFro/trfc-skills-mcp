# skills-mcp

My skill library, served to any MCP client from one repo. Skills live in `skills/`, categories (phase playbooks such as `build`) in `categories/`. Edit, push, and every device picks it up.

## Layout

```
skills/<name>/SKILL.md        # frontmatter: name, description, related?, source?
skills/<name>/...             # supporting files, fetched on demand
categories/<name>.md          # frontmatter: description, primary, secondary; body is the playbook
```

Each category ranks its skills:

- `primary` — the defaults. Inlined in full when the category loads; the agent applies them.
- `secondary` — listed by one-line description only. The agent loads one only when it clearly fits the task better than the primaries.

`related:` on a skill cross-references other skills; they show up as secondary when a primary that names them loads.

Selection is decided by the files, not by the model: "use my skills to build X" is one `load_category` call that returns exactly what to apply. No skill-picking subagent or fast model is needed; spawning one costs more than the call.

## What the server exposes

Manual-only by design: every tool description tells the model to call it only when you ask for the skills server.

| | |
|---|---|
| Tools | `list_skills`, `load_category(name)`, `get_skill(name, file?)` |
| Prompts | one per category (`build`, `ship`, …) plus `skill(name)` |

In Claude Code the prompts are slash commands: `/mcp__skills__build add auth to the app`. Elsewhere, say "use my skills server to build X".

## Setup on a device

Requires Node ≥ 22.18 (runs the TypeScript directly; no build step).

```sh
git clone git@github.com:AusFro/skills-mcp.git ~/skills-mcp
cd ~/skills-mcp && npm install
```

Point the client at it (stdio):

```sh
claude mcp add --scope user skills -- node ~/skills-mcp/src/stdio.ts
```

```json
{ "mcpServers": { "skills": { "command": "node", "args": ["/Users/me/skills-mcp/src/stdio.ts"] } } }
```

On start the server runs `git pull --ff-only` in the background (`SKILLS_AUTO_PULL=0` disables it), and every tool call re-reads the files, so pushed edits arrive without reinstalling anything.

## Remote (Netlify)

For clients that only take a URL (claude.ai, mobile), the same server deploys as a stateless Netlify function at `/mcp`. Connect the repo in Netlify; each push redeploys. The content is public anyway, so it has no auth.

```sh
npx netlify-cli dev     # local: http://localhost:8888/mcp
```

## Adding skills

```sh
npm run import -- https://github.com/anthropics/skills/tree/main/skills/mcp-builder --category build   # secondary
npm run import -- ~/.claude/skills/some-skill --category build --primary                              # primary (moves it up if already secondary)
npm run import -- https://raw.githubusercontent.com/o/r/main/SKILL.md --name my-skill
npm run check           # every category/related reference resolves
```

Imports from URLs record `source:` so the skill can be re-imported to update it.

## Develop

```sh
npm test
npm run typecheck
npm run inspect         # MCP Inspector against the stdio server
```
