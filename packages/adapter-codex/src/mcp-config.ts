import type { McpServer } from '@skaro/timeline';

/** Thread-local configuration; never edits the user's global MCP settings. */
export function codexMcpConfig(servers: Record<string, McpServer> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [
      `mcp_servers.${name}`,
      {
        ...(server.type === 'http'
          ? { url: server.url, ...(server.headers ? { http_headers: server.headers } : {}) }
          : {
              command: server.command,
              args: server.args,
              ...(server.env ? { env: server.env } : {}),
            }),
        ...(server.trusted ? { default_tools_approval_mode: 'approve' } : {}),
      },
    ]),
  );
}
