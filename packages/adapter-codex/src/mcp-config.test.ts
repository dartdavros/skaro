import { describe, expect, it } from 'vitest';
import { codexMcpConfig } from './mcp-config.ts';

describe('thread-local MCP configuration', () => {
  it('preserves authenticated HTTP and isolated stdio servers without granting browser trust', () => {
    expect(
      codexMcpConfig({
        skaro: {
          type: 'http',
          url: 'http://127.0.0.1:1/mcp',
          headers: { Authorization: 'Bearer session' },
          trusted: true,
        },
        playwright: {
          type: 'stdio',
          command: 'node',
          args: ['cli.js', '--isolated'],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      }),
    ).toEqual({
      'mcp_servers.skaro': {
        url: 'http://127.0.0.1:1/mcp',
        http_headers: { Authorization: 'Bearer session' },
        default_tools_approval_mode: 'approve',
      },
      'mcp_servers.playwright': {
        command: 'node',
        args: ['cli.js', '--isolated'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
    });
  });
});
