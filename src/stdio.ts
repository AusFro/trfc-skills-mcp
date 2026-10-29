#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

const root = process.env.SKILLS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Fast-forward the clone in the background so edits pushed from another device
// arrive without blocking startup. Tools re-read from disk, so they see the
// pulled content as soon as it lands. stdout belongs to the MCP protocol.
if (process.env.SKILLS_AUTO_PULL !== "0" && existsSync(path.join(root, ".git"))) {
  spawn("git", ["-C", root, "pull", "--ff-only", "--quiet"], { stdio: "ignore" }).on("error", () => {});
}

const server = await createServer(root);
await server.connect(new StdioServerTransport());
