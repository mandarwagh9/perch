import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PerchClient } from './client.ts';
import { TOOL_DEFS, callTool, newSession } from './tools.ts';

/**
 * Perch MCP server — exposes Perch to a coding agent (Claude Code, Cursor, …) as
 * first-class tools, so the agent deploys and shares the software it builds without
 * ever leaving its own environment. Point it at a running Perch via PERCH_URL.
 */
async function main(): Promise<void> {
  const baseUrl = process.env.PERCH_URL ?? 'http://localhost:8787';
  const client = new PerchClient(baseUrl, process.env.PERCH_TOKEN);
  const session = newSession();

  const server = new Server({ name: 'perch', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const text = await callTool(client, session, name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
  // eslint-disable-next-line no-console
  console.error(`Perch MCP server ready (backend: ${baseUrl})`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
