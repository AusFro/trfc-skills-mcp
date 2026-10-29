import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "../../src/server.ts";

// Netlify bundles skills/ and categories/ via `included_files` and runs the
// function from the site root.
const root = process.env.SKILLS_ROOT ?? process.cwd();

export default async (request: Request): Promise<Response> => {
  // Stateless: a fresh server per request, since function instances share nothing.
  const server = await createServer(root);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
};

export const config = { path: "/mcp" };
