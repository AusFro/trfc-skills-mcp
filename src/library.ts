import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type Skill = {
  name: string;
  description: string;
  related: string[];
  source?: string;
  body: string;
  /** Supporting files beside SKILL.md, as paths relative to the skill directory. */
  files: string[];
  dir: string;
};

export type Category = {
  name: string;
  description: string;
  /** Loaded in full whenever the category is loaded. */
  skills: string[];
  /** Listed by description only; the agent fetches the ones the task needs. */
  optional: string[];
  playbook: string;
};

export type Library = {
  skills: Map<string, Skill>;
  categories: Map<string, Category>;
  problems: string[];
};

export const FAVORITES = "favorites";

export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  return { data: (parseYaml(match[1]) ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) };
}

function stringList(value: unknown): string[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    else if (rel !== "SKILL.md") out.push(rel);
  }
  return out.sort();
}

async function isDirectory(p: string): Promise<boolean> {
  return stat(p).then((s) => s.isDirectory(), () => false);
}

/**
 * Reads the library from disk. Called per request rather than cached so edits
 * (and background `git pull`s) show up without restarting the client.
 * Never throws for bad content; malformed entries are reported in `problems`.
 */
export async function loadLibrary(root: string): Promise<Library> {
  const skills = new Map<string, Skill>();
  const categories = new Map<string, Category>();
  const problems: string[] = [];

  const skillsDir = path.join(root, "skills");
  if (await isDirectory(skillsDir)) {
    for (const entry of (await readdir(skillsDir, { withFileTypes: true })).filter((e) => e.isDirectory())) {
      const dir = path.join(skillsDir, entry.name);
      const text = await readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => null);
      if (text == null) {
        problems.push(`skills/${entry.name}: missing SKILL.md`);
        continue;
      }
      const { data, body } = splitFrontmatter(text);
      if (data.name && data.name !== entry.name) {
        problems.push(`skills/${entry.name}: frontmatter name "${data.name}" differs from directory name`);
      }
      if (!data.description) problems.push(`skills/${entry.name}: missing description`);
      skills.set(entry.name, {
        name: entry.name,
        description: String(data.description ?? ""),
        related: stringList(data.related),
        source: data.source ? String(data.source) : undefined,
        body: body.trim(),
        files: await listFiles(dir),
        dir,
      });
    }
  }

  const categoriesDir = path.join(root, "categories");
  if (await isDirectory(categoriesDir)) {
    for (const file of (await readdir(categoriesDir)).filter((f) => f.endsWith(".md")).sort()) {
      const name = file.slice(0, -3);
      const { data, body } = splitFrontmatter(await readFile(path.join(categoriesDir, file), "utf8"));
      categories.set(name, {
        name,
        description: String(data.description ?? ""),
        skills: stringList(data.skills),
        optional: stringList(data.optional),
        playbook: body.trim(),
      });
    }
  }

  for (const skill of skills.values()) {
    for (const ref of skill.related) {
      if (!skills.has(ref)) problems.push(`skills/${skill.name}: related skill "${ref}" does not exist`);
    }
  }
  for (const category of categories.values()) {
    for (const ref of [...category.skills, ...category.optional]) {
      if (!skills.has(ref)) problems.push(`categories/${category.name}.md: skill "${ref}" does not exist`);
    }
  }

  return { skills, categories, problems };
}

export async function readSkillFile(skill: Skill, file: string): Promise<string> {
  if (!skill.files.includes(file)) {
    throw new Error(`"${file}" is not a file of skill "${skill.name}". Files: ${skill.files.join(", ") || "none"}`);
  }
  return readFile(path.join(skill.dir, file), "utf8");
}
