#!/usr/bin/env node
// Imports a skill into skills/<name>/ from a GitHub URL, a raw .md URL, or a local path.
//
//   npm run import -- <source> [--name <name>] [--category <category>]... [--favorite]
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { stringify } from "yaml";
import { FAVORITES, splitFrontmatter } from "../src/library.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    category: { type: "string", multiple: true, default: [] },
    favorite: { type: "boolean", default: false },
  },
});
const source = positionals[0];
if (!source) {
  console.error("usage: npm run import -- <github-url|raw-md-url|local-path> [--name n] [--category c] [--favorite]");
  process.exit(1);
}

function githubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

async function fetchOk(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

type GitHubEntry = { type: "file" | "dir"; path: string; name: string; download_url: string | null };

/** Copies a GitHub directory into `dest`, recursively, via the contents API. */
async function downloadGitHubDir(owner: string, repo: string, ref: string | undefined, dir: string, dest: string) {
  const token = githubToken();
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const entries = (await (
    await fetchOk(`https://api.github.com/repos/${owner}/${repo}/contents/${dir}${query}`, headers)
  ).json()) as GitHubEntry[] | GitHubEntry;
  if (!Array.isArray(entries)) throw new Error(`${dir} is a file, expected a skill directory`);
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const target = path.join(dest, entry.name);
    if (entry.type === "dir") await downloadGitHubDir(owner, repo, ref, entry.path, target);
    else if (entry.download_url) {
      await writeFile(target, Buffer.from(await (await fetchOk(entry.download_url)).arrayBuffer()));
    }
  }
}

/** Fetches `source` into a staging directory and returns the directory holding SKILL.md. */
async function stage(staging: string): Promise<string> {
  const github = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)\/?(.*))?$/.exec(source);
  if (github) {
    const [, owner, repo, kind, ref, rest = ""] = github;
    const dir = kind === "blob" ? path.posix.dirname(rest) : rest.replace(/\/$/, "");
    await downloadGitHubDir(owner, repo, ref, dir === "." ? "" : dir, staging);
    return staging;
  }
  if (/^https?:\/\//.test(source)) {
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "SKILL.md"), await (await fetchOk(source)).text());
    return staging;
  }
  const local = path.resolve(source);
  const dir = (await stat(local)).isDirectory() ? local : path.dirname(local);
  await cp(dir, staging, { recursive: true });
  return staging;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function serialize(data: Record<string, unknown>, body: string): string {
  return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trimStart()}`;
}

async function addToCategory(category: string, skill: string) {
  const file = path.join(root, "categories", `${category}.md`);
  const existing = await readFile(file, "utf8").catch(() => null);
  const { data, body } = existing
    ? splitFrontmatter(existing)
    : { data: { description: `TODO: describe the ${category} category`, skills: [] as string[] }, body: "" };
  const skills = new Set((data.skills as string[] | undefined) ?? []);
  skills.add(skill);
  data.skills = [...skills];
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, serialize(data, body));
  console.log(`${existing ? "updated" : "created"} categories/${category}.md`);
}

const staging = path.join(root, ".import-staging");
await rm(staging, { recursive: true, force: true });
try {
  const dir = await stage(staging);
  const skillFile = path.join(dir, "SKILL.md");
  const { data, body } = splitFrontmatter(await readFile(skillFile, "utf8").catch(() => {
    throw new Error(`no SKILL.md found at ${source}`);
  }));

  const name = slugify(values.name ?? String(data.name ?? path.basename(source.replace(/\/(SKILL\.md)?$/i, ""))));
  if (!name) throw new Error("could not derive a skill name; pass --name");
  data.name = name;
  if (/^https?:\/\//.test(source)) data.source = source;
  await writeFile(skillFile, serialize(data, body));

  const dest = path.join(root, "skills", name);
  const replaced = await stat(dest).then(() => true, () => false);
  await rm(dest, { recursive: true, force: true });
  await cp(dir, dest, { recursive: true });
  console.log(`${replaced ? "replaced" : "imported"} skills/${name}`);

  for (const category of values.favorite ? [...values.category, FAVORITES] : values.category) {
    await addToCategory(category, name);
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
