import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { FAVORITES, loadLibrary, readSkillFile, type Library, type Skill } from "./library.ts";

const MANUAL_ONLY =
  "Only use this when the user explicitly asks to use the skills server (e.g. \"use my skills\", \"use the skills MCP\"). Never call it on your own initiative.";

const INSTRUCTIONS = `This server holds the user's personal skill library: skills (reusable instructions) grouped into categories (playbooks for a phase of work such as "build" or "review").
${MANUAL_ONLY}
When asked, start with load_category for the phase the user names (or list_skills if unsure which), follow its playbook, and fetch optional or related skills with get_skill only when the task needs them.`;

function bullet(skill: Skill | undefined, name: string): string {
  return skill ? `- **${name}** — ${skill.description}` : `- **${name}** — (missing)`;
}

export function renderCatalog(lib: Library): string {
  const favorites = new Set(lib.categories.get(FAVORITES)?.skills ?? []);
  const lines = ["# Skill library", ""];
  if (favorites.size) {
    lines.push("## Favorites", ...[...favorites].map((n) => bullet(lib.skills.get(n), n)), "");
  }
  lines.push("## Categories");
  for (const c of lib.categories.values()) {
    if (c.name === FAVORITES) continue;
    const members = [...c.skills, ...c.optional.map((n) => `${n} (optional)`)];
    lines.push(`- **${c.name}** — ${c.description}${members.length ? ` [${members.join(", ")}]` : ""}`);
  }
  lines.push("", "## All skills");
  for (const s of lib.skills.values()) lines.push(`${bullet(s, s.name)}${favorites.has(s.name) ? " ★" : ""}`);
  if (lib.problems.length) lines.push("", "## Library problems", ...lib.problems.map((p) => `- ${p}`));
  return lines.join("\n");
}

function renderSkillBody(skill: Skill): string {
  const parts = [skill.body];
  if (skill.files.length) {
    parts.push(`Supporting files (fetch with get_skill + file): ${skill.files.join(", ")}`);
  }
  return parts.join("\n\n");
}

export function renderSkill(lib: Library, skill: Skill): string {
  const parts = [`# Skill: ${skill.name}`, `> ${skill.description}`, renderSkillBody(skill)];
  if (skill.related.length) {
    parts.push(["## Related skills", ...skill.related.map((n) => bullet(lib.skills.get(n), n))].join("\n"));
  }
  return parts.join("\n\n");
}

export function renderCategory(lib: Library, name: string): string {
  const category = lib.categories.get(name)!;
  const parts = [`# Category: ${category.name}`, `> ${category.description}`];
  if (category.playbook) parts.push(`## Playbook\n\n${category.playbook}`);

  const loaded = category.skills.map((n) => lib.skills.get(n)).filter((s): s is Skill => s != null);
  for (const skill of loaded) {
    parts.push(`## Skill: ${skill.name}\n\n> ${skill.description}\n\n${renderSkillBody(skill)}`);
  }

  const included = new Set(category.skills);
  const optional = category.optional.filter((n) => !included.has(n));
  const related = [...new Set(loaded.flatMap((s) => s.related))].filter((n) => !included.has(n) && !optional.includes(n));
  const more = [...optional, ...related];
  if (more.length) {
    parts.push(
      [
        "## More skills — fetch with get_skill only if the task needs them",
        ...optional.map((n) => bullet(lib.skills.get(n), n)),
        ...related.map((n) => `${bullet(lib.skills.get(n), n)} (related)`),
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], isError };
}

function unknown(kind: string, name: string, known: Iterable<string>) {
  return text(`Unknown ${kind} "${name}". Available: ${[...known].join(", ") || "none"}`, true);
}

/**
 * Builds the MCP server. Prompts are registered from the categories present
 * at startup; tools re-read the library on every call.
 */
export async function createServer(root: string): Promise<McpServer> {
  const server = new McpServer({ name: "skills", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_skills",
    {
      description: `List the skill library: favorites, categories and every skill with its description. ${MANUAL_ONLY}`,
      annotations: { readOnlyHint: true },
    },
    async () => text(renderCatalog(await loadLibrary(root))),
  );

  server.registerTool(
    "load_category",
    {
      description: `Load a category (e.g. "build"): its playbook, the full text of its core skills, and a list of optional and related skills. ${MANUAL_ONLY}`,
      inputSchema: { name: z.string().describe("Category name, e.g. build") },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const lib = await loadLibrary(root);
      return lib.categories.has(name) ? text(renderCategory(lib, name)) : unknown("category", name, lib.categories.keys());
    },
  );

  server.registerTool(
    "get_skill",
    {
      description: `Get one skill's full instructions, or one of its supporting files. ${MANUAL_ONLY}`,
      inputSchema: {
        name: z.string().describe("Skill name"),
        file: z.string().optional().describe("Supporting file path listed by the skill, e.g. references/api.md"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name, file }) => {
      const lib = await loadLibrary(root);
      const skill = lib.skills.get(name);
      if (!skill) return unknown("skill", name, lib.skills.keys());
      if (!file) return text(renderSkill(lib, skill));
      try {
        return text(await readSkillFile(skill, file));
      } catch (error) {
        return text((error as Error).message, true);
      }
    },
  );

  const startup = await loadLibrary(root);
  for (const category of startup.categories.values()) {
    server.registerPrompt(
      category.name,
      {
        description: `Skills: ${category.description}`,
        argsSchema: { task: z.string().optional().describe("What to do") },
      },
      async ({ task }) => {
        const lib = await loadLibrary(root);
        const body = lib.categories.has(category.name)
          ? renderCategory(lib, category.name)
          : `Category "${category.name}" no longer exists.`;
        const ask = task ? `\n\n---\n\nUsing the skills above, do this: ${task}` : "";
        return { messages: [{ role: "user", content: { type: "text", text: body + ask } }] };
      },
    );
  }

  server.registerPrompt(
    "skill",
    {
      description: "Skills: load one skill by name",
      argsSchema: {
        name: completable(z.string(), async (value) =>
          [...(await loadLibrary(root)).skills.keys()].filter((n) => n.startsWith(value)),
        ),
      },
    },
    async ({ name }) => {
      const lib = await loadLibrary(root);
      const skill = lib.skills.get(name);
      const body = skill ? renderSkill(lib, skill) : `Unknown skill "${name}". Available: ${[...lib.skills.keys()].join(", ")}`;
      return { messages: [{ role: "user", content: { type: "text", text: body } }] };
    },
  );

  return server;
}
