import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { loadLibrary, readSkillFile, type Library, type Skill } from "./library.ts";

const MANUAL_ONLY =
  "Only use this when the user explicitly asks to use the skills server (e.g. \"use trfc-skills\", \"use my skills\"). Never call it on your own initiative.";

const INSTRUCTIONS = `This server holds the user's skill library: skills (reusable instructions) grouped into categories (one per phase of work, e.g. "build", "ship").
${MANUAL_ONLY}
Selection is already done for you, so this is one lookup, not research:
1. Call load_category once for the phase the user names. Use list_skills only if no category fits.
2. Apply its primary skills. They are the user's chosen defaults.
3. Load a secondary skill with get_skill only when its one-line description fits the task clearly better than the primaries. Otherwise ignore them.
Do not browse the library or read skills you will not apply.`;

function bullet(skill: Skill | undefined, name: string): string {
  return skill ? `- **${name}** — ${skill.description}` : `- **${name}** — (missing)`;
}

export function renderCatalog(lib: Library): string {
  const lines = ["# Skill library", "", "## Categories"];
  for (const c of lib.categories.values()) {
    const secondary = c.secondary.length ? `; secondary: ${c.secondary.join(", ")}` : "";
    lines.push(`- **${c.name}** — ${c.description} (primary: ${c.primary.join(", ") || "none"}${secondary})`);
  }
  lines.push("", "## All skills", ...[...lib.skills.values()].map((s) => bullet(s, s.name)));
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

  const primary = category.primary.map((n) => lib.skills.get(n)).filter((s): s is Skill => s != null);
  parts.push(`## Primary skills — apply these${primary.length ? "" : "\n\nNone set."}`);
  for (const skill of primary) {
    parts.push(`### ${skill.name}\n\n> ${skill.description}\n\n${renderSkillBody(skill)}`);
  }

  const shown = new Set(category.primary);
  const secondary = category.secondary.filter((n) => !shown.has(n));
  secondary.forEach((n) => shown.add(n));
  const related = [...new Set(primary.flatMap((s) => s.related))].filter((n) => !shown.has(n));
  if (secondary.length || related.length) {
    parts.push(
      [
        "## Secondary skills — load with get_skill only if one clearly fits better than the primaries",
        ...secondary.map((n) => bullet(lib.skills.get(n), n)),
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
  const server = new McpServer({ name: "trfc-skills", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_skills",
    {
      description: `List every category with its primary and secondary skills, and every skill with its description. ${MANUAL_ONLY}`,
      annotations: { readOnlyHint: true },
    },
    async () => text(renderCatalog(await loadLibrary(root))),
  );

  server.registerTool(
    "load_category",
    {
      description: `Load a category (e.g. "build"): its playbook, the full text of its primary skills, and one-line descriptions of its secondary skills. Usually the only call needed. ${MANUAL_ONLY}`,
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
