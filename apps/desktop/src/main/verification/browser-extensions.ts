import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connectMcpExtension, createMcpImageStore } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { taskBrowserServer } from '../task-browser';
import { approvedTool, extensionSession } from './extension-session';

export async function verifyBrowserExtensions(
  directory: string,
  owner: RuntimeProcessIdentity,
  address: string,
) {
  const url = new URL(address);
  assert(
    ['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:',
    'Supply the real local task URL',
  );
  const readiness = await fetch(new URL('/api/v1/health/ready/', url), {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(readiness.status, 200, 'Real task backend is not ready');
  const health = (await readiness.json()) as { checks?: { database?: boolean; redis?: boolean } };
  assert(health.checks?.database && health.checks.redis, 'Actual database and Redis are required');
  const controller = new AbortController();
  const processes: RuntimeProcessIdentity[] = [];
  const allowed = [
    'browser_navigate',
    'browser_evaluate',
    'browser_take_screenshot',
    'browser_console_messages',
  ].map((name) => ({ name, readOnly: false }));
  const extension = await connectMcpExtension({
    id: 'browser',
    config: await taskBrowserServer(directory, 'ba5'),
    cwd: process.cwd(),
    signal: controller.signal,
    allowed,
    images: await createMcpImageStore(join(directory, 'images')),
    processes: {
      async admit(identity, signal) {
        signal.throwIfAborted();
        assert.equal(await processBirth(identity.pid), identity.birth);
        processes.push(identity);
      },
      async exited(identity) {
        assert.notEqual(await processBirth(identity.pid), identity.birth);
      },
    },
  });
  const session = await extensionSession(directory, 'browser', owner, extension);
  const invoke = (id: string, name: string, args: unknown) =>
    approvedTool(session, id, `mcp__browser__${name}`, args);
  try {
    const navigation = await invoke('navigate', 'browser_navigate', { url: url.href });
    assert(!navigation.isError, navigation.text);
    const observed = await invoke('ready', 'browser_evaluate', {
      function:
        "async () => { const response = await fetch('/api/v1/health/ready/'); const body = await response.json(); if (response.status !== 200 || !body.checks?.database || !body.checks?.redis) throw new Error('Real backend readiness failed'); return {url: location.href, title: document.title, readiness: body}; }",
    });
    assert(!observed.isError, observed.text);
    const shot = await invoke('screenshot', 'browser_take_screenshot', {
      type: 'png',
      scale: 'css',
      fullPage: true,
    });
    assert(!shot.isError, shot.text);
    assert(shot.artifacts?.length, 'Real MCP image was not persisted by the host');
    const image = shot.artifacts[0]!;
    const bytes = await readFile(image.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
    assert.equal(bytes.length, image.bytes);
    const journal = JSON.stringify(session.journal.records);
    assert(
      !journal.includes(bytes.toString('base64')),
      'Binary media entered the model-readable journal',
    );
    const diagnostics = await invoke('console', 'browser_console_messages', { level: 'error' });
    assert(!diagnostics.isError, diagnostics.text);
    await session.dispose();
    assert(processes.length === 1);
    assert.notEqual(await processBirth(processes[0]!.pid), processes[0]!.birth);
    return {
      taskUrl: url.href,
      actualBackend: health,
      browserObservation: observed.text,
      screenshot: image,
      console: diagnostics.text,
      approvalBeforeIntent: true,
      journalBase64: 0,
      processExitConfirmed: true,
      modelRequests: 0,
    };
  } finally {
    controller.abort();
    await session.dispose();
    await extension.close();
  }
}
