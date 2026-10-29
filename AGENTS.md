# Maintaining this library

- Add third-party skills with `npm run import -- <url> [--category c] [--favorite]`, not by hand; it records `source:`.
- A skill is `skills/<name>/SKILL.md`; the directory name is the skill name and must match frontmatter `name`.
- Categories are `categories/<name>.md`. `skills:` are inlined in full when the category loads, so keep that list short; put the rest in `optional:`.
- Cross-reference skills with `related: [...]` in frontmatter, not prose links.
- Run `npm run check` and `npm test` before committing.
