# Maintaining this library

- Add third-party skills with `npm run import -- <url> [--category c]... [--primary]`, not by hand; it records `source:`.
- A skill is `skills/<name>/SKILL.md`; the directory name is the skill name and must match frontmatter `name`.
- Categories are `categories/<name>.md`. `primary:` skills are inlined in full when the category loads and are the defaults, so keep that list to the best few; everything else goes in `secondary:`. Never add a skill as primary unless the user says so.
- Cross-reference skills with `related: [...]` in frontmatter, not prose links.
- Run `npm run check` and `npm test` before committing.
