import type { McpServer } from '@skaro/timeline';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Official server over stdio: an isolated browser per agent session, no shared personal profile. */
export async function taskBrowserServer(dataDir: string, runId: string): Promise<McpServer> {
  const outputDir = join(dataDir, 'browsers', runId);
  await mkdir(outputDir, { recursive: true });
  const require = createRequire(join(__dirname, 'package.json'));
  const cli = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js').replace(
    /app\.asar([/\\])/,
    'app.asar.unpacked$1',
  );
  return {
    type: 'stdio',
    command: process.execPath,
    args: [
      cli,
      '--isolated',
      '--headless',
      '--browser',
      'chrome',
      '--output-dir',
      outputDir,
      '--timeout-action',
      '10000',
      '--timeout-navigation',
      '45000',
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}
