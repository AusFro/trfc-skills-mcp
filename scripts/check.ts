#!/usr/bin/env node
// Validates the library: frontmatter, and that every category/related reference resolves.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "../src/library.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = await loadLibrary(root);

console.log(`${lib.skills.size} skills, ${lib.categories.size} categories`);
for (const problem of lib.problems) console.error(`✗ ${problem}`);
process.exit(lib.problems.length ? 1 : 0);
