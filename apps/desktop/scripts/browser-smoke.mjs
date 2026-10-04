// Exercises the same official MCP configuration as a task, against a real project URL.
// No server, API replacement, accounts or application data are created.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskBrowserServer } from '../src/main/task-browser.ts';

const url = process.argv[2];
if (!url) throw new Error('Usage: node browser-smoke.mjs REAL_PROJECT_URL [OUTPUT_DIR]');
const here = dirname(fileURLToPath(import.meta.url));
// The production helper executes in Electron's CJS main bundle.
globalThis.__dirname = here;
const require = createRequire(join(here, '../../../packages/mcp-server/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const output = resolve(process.argv[3] ?? join(here, '../test-results/mcp-browser'));
const server = await taskBrowserServer(output, 'smoke');
if (server.type !== 'stdio') throw new Error('Expected the task browser stdio configuration');
const transport = new StdioClientTransport({
  command: process.env.SKARO_SMOKE_EXECUTABLE ?? server.command,
  args: server.args,
  env: { ...process.env, ...server.env },
  stderr: 'pipe',
});
transport.stderr?.on('data', (data) => process.stderr.write(data));
const client = new Client({ name: 'skaro-browser-smoke', version: '1' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(`Connected official task browser: ${tools.tools.length} tools`);
  for (const [name, args] of [
    ['browser_navigate', { url }],
    [
      'browser_evaluate',
      {
        function: `async () => { const response = await fetch('/api/v1/health/ready/'); const body = await response.json(); if (response.status !== 200 || !body.checks?.database || !body.checks?.redis) throw new Error('Real backend readiness failed'); return {url: location.href, title: document.title, readiness: body}; }`,
      },
    ],
    ['browser_wait_for', { textGone: 'Загрузка' }],
    [
      'browser_take_screenshot',
      { type: 'png', filename: join(output, 'browsers/smoke/real-project.png'), fullPage: true },
    ],
    ['browser_console_messages', { level: 'error' }],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
    for (const content of result.content ?? [])
      if (content.type === 'text') console.log(content.text);
  }
} finally {
  await client.close();
  await transport.close();
}
