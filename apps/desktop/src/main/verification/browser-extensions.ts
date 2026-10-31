import assert from 'node:assert/strict';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connectMcpExtension, createMcpImageStore } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { taskBrowserServer } from '../task-browser';
import { approvedTool, extensionSession } from './extension-session';
import { CAT_PILOT_OBSERVATION } from './browser-target';

export async function verifyBrowserExtensions(
  directory: string,
  owner: RuntimeProcessIdentity,
  target: { root: string; url: string },
) {
  const url = new URL(target.url);
  assert.equal(url.protocol, 'file:');
  const config = await taskBrowserServer(directory, 'ba6-cat-pilot');
  assert.equal(config.type, 'stdio');
  if (config.type !== 'stdio') throw new Error('Official stdio browser required');
  // The static project's documented launch uses file://. This applies only to this
  // fixed host driver and its registered target, never to the product/browser defaults.
  config.args.push('--allow-unrestricted-file-access');
  const controller = new AbortController();
  const processes: RuntimeProcessIdentity[] = [];
  const allowed = [
    'browser_navigate',
    'browser_evaluate',
    'browser_take_screenshot',
    'browser_console_messages',
  ].map((name) => ({
    name,
    readOnly: false,
    observation: { kind: 'browser' as const, criteria: ['BA-6 real task browser evidence'] },
  }));
  const extension = await connectMcpExtension({
    id: 'browser',
    config,
    cwd: target.root,
    signal: controller.signal,
    allowed,
    images: await createMcpImageStore(join(directory, 'long-context-artifacts', 'images')),
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
  const session = await extensionSession(directory, 'browser', owner, extension, target.root);
  const invoke = (id: string, name: string, args: unknown) =>
    approvedTool(session, id, `mcp__browser__${name}`, args);
  try {
    const navigation = await invoke('navigate', 'browser_navigate', { url: url.href });
    assert(!navigation.isError, navigation.text);
    const observed = await invoke('scene', 'browser_evaluate', {
      function: CAT_PILOT_OBSERVATION,
    });
    assert(!observed.isError, observed.text);
    const shot = await invoke('screenshot', 'browser_take_screenshot', {
      type: 'png',
      scale: 'css',
      fullPage: true,
    });
    assert(!shot.isError, shot.text);
    const reference = (shot as typeof shot & { evidence: { sequence: number; hash: string } })
      .evidence;
    assert(reference, 'Host-bound browser evidence was not recorded');
    const validation = await session.execute({
      id: 'validate-shot',
      action: { type: 'tool', name: 'check_evidence', args: reference },
    });
    assert.deepEqual(
      validation.result.value &&
        Object.fromEntries(
          Object.entries(validation.result.value as Record<string, unknown>).filter(([key]) =>
            [
              'inputsCurrent',
              'outputCurrent',
              'environmentCurrent',
              'artifactsCurrent',
              'sourceCurrent',
              'latestObservation',
            ].includes(key),
          ),
        ),
      {
        inputsCurrent: true,
        outputCurrent: true,
        artifactsCurrent: true,
        sourceCurrent: true,
        latestObservation: true,
        environmentCurrent: true,
      },
    );
    assert(shot.artifacts?.length, 'Real MCP image was not persisted by the host');
    const image = shot.artifacts[0]!;
    const bytes = await readFile(image.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
    assert.equal(bytes.length, image.bytes);
    const parked = `${image.path}.verification-missing`;
    await rename(image.path, parked);
    try {
      const unavailable = await session.execute({
        id: 'missing-image',
        action: { type: 'tool', name: 'check_evidence', args: reference },
      });
      assert.equal(
        (unavailable.result.value as { artifactsCurrent: boolean }).artifactsCurrent,
        false,
      );
    } finally {
      await rename(parked, image.path);
    }
    const journal = JSON.stringify(session.journal.records);
    assert(
      !journal.includes(bytes.toString('base64')),
      'Binary media entered the model-readable journal',
    );
    const diagnostics = await invoke('console', 'browser_console_messages', { level: 'error' });
    assert(!diagnostics.isError, diagnostics.text);
    const historical = await session.execute({
      id: 'historical-shot',
      action: { type: 'tool', name: 'check_evidence', args: reference },
    });
    assert.equal(
      (historical.result.value as { latestObservation: boolean }).latestObservation,
      false,
    );
    await session.dispose();
    assert(processes.length === 1);
    assert.notEqual(await processBirth(processes[0]!.pid), processes[0]!.birth);
    return {
      taskUrl: url.href,
      project: 'Cat-pilot',
      inputRoot: target.root,
      launch: 'documented file:// index.html',
      browserObservation: observed.text,
      screenshot: image,
      console: diagnostics.text,
      approvalBeforeIntent: true,
      journalBase64: 0,
      processExitConfirmed: true,
      modelRequests: 0,
      evidence: reference,
      evidenceValidated: true,
      olderObservationMarkedHistorical: true,
      missingImageRejected: true,
    };
  } finally {
    controller.abort();
    await session.dispose();
    await extension.close();
  }
}
