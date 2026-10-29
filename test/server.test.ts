import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "skills-mcp-"));
  const skill = async (name: string, frontmatter: string, body: string) => {
    await mkdir(path.join(root, "skills", name, "references"), { recursive: true });
    await writeFile(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\n${frontmatter}\n---\n${body}`);
  };
  await skill("tdd", "description: Test first\nrelated: [design]", "Write the test first.");
  await skill("design", "description: Deep modules", "Hide complexity.");
  await skill("perf", "description: Make it fast", "Measure.");
  await writeFile(path.join(root, "skills", "tdd", "references", "mocks.md"), "Avoid mocks.");
  await mkdir(path.join(root, "categories"));
  await writeFile(
    path.join(root, "categories", "build.md"),
    "---\ndescription: Build features\nskills: [tdd]\noptional: [perf]\n---\nShip small.",
  );
  await writeFile(path.join(root, "categories", "favorites.md"), "---\ndescription: Favorites\nskills: [design]\n---\n");
  return root;
}

async function connect(root: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await (await createServer(root)).connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { text: string }[])[0].text;
}

test("load_category inlines core skills and lists optional and related ones", async () => {
  const client = await connect(await fixture());
  const out = textOf(await client.callTool({ name: "load_category", arguments: { name: "build" } }));
  assert.match(out, /Ship small\./);
  assert.match(out, /## Skill: tdd[\s\S]*Write the test first\./);
  assert.match(out, /\*\*perf\*\* — Make it fast/);
  assert.match(out, /\*\*design\*\* — Deep modules \(related\)/);
  assert.doesNotMatch(out, /Hide complexity\./);
});

test("get_skill returns supporting files and rejects unknown ones", async () => {
  const client = await connect(await fixture());
  const file = await client.callTool({ name: "get_skill", arguments: { name: "tdd", file: "references/mocks.md" } });
  assert.equal(textOf(file), "Avoid mocks.");
  const escape = await client.callTool({ name: "get_skill", arguments: { name: "tdd", file: "../perf/SKILL.md" } });
  assert.equal(escape.isError, true);
});

test("list_skills marks favorites and categories become prompts", async () => {
  const client = await connect(await fixture());
  assert.match(textOf(await client.callTool({ name: "list_skills", arguments: {} })), /\*\*design\*\* — Deep modules ★/);
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
  assert.deepEqual(prompts, ["build", "favorites", "skill"]);
  const prompt = await client.getPrompt({ name: "build", arguments: { task: "a todo app" } });
  assert.match((prompt.messages[0].content as { text: string }).text, /do this: a todo app$/);
});
