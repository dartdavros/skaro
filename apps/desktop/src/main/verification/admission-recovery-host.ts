import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { AppDb } from '@skaro/core';
import { startBundledSession } from '@skaro/agents';
import type { AgentSession, RuntimeProcessIdentity } from '@skaro/timeline';
import { NativeAdmissions } from '../native/admissions';
import { nativeProbeConfig } from './native-probe-options';
import { processBirth } from '../process-identity';

/** A real separate admission host. Its deliberate exit tests persisted recovery, not fake history. */
let session: AgentSession | undefined;
let lease: NativeAdmissions | undefined;
const db = AppDb.open(process.argv[2]!);
const directory = process.argv[3]!;
const projectId = process.argv[4]!;
const ownerKey = process.argv[5]!;
const entries = resolve('apps/desktop/out/main');
async function cleanup() {
  if (lease) await lease.revoke(lease.admission, 'Verification host cleanup');
  await session?.close();
  if (lease) await lease.confirmExit(lease.admission);
  db.close();
}
process.on('disconnect', () => {
  void cleanup().finally(() => process.exit(1));
});
void (async () => {
  const project = db.getProject(projectId);
  assert(project?.name.toLowerCase() === 'cat-pilot');
  const config = nativeProbeConfig(directory, project.path, 'native-admission-recovery', true);
  config.tools!.commandEntry = join(entries, 'agent-command-worker.js');
  lease = await NativeAdmissions.prepare({
    db,
    ownerKey,
    sessionId: config.sessionId,
    scope: { kind: 'project_chat', projectId },
    signal: new AbortController().signal,
    async requireCurrent(signal) {
      signal.throwIfAborted();
      assert.equal(db.getProject(projectId)?.path, project.path);
    },
  });
  let owner: RuntimeProcessIdentity | undefined;
  session = await startBundledSession('skaro', {
    config,
    entry: join(entries, 'agent-runtime-worker.js'),
    raw: () => undefined,
    processStarted(pid, identity) {
      assert(identity);
      owner = { pid, ...identity };
      lease!.recordOwnership(owner);
    },
  });
  const actual = session;
  void (async () => {
    for await (const _event of actual.events) {
      /* Actual child events. */
    }
  })();
  await lease.requireActive(lease.admission, new AbortController().signal);
  assert('invokeTool' in session && typeof session.invokeTool === 'function');
  const result = (await session.invokeTool(
    'find_files',
    { pattern: 'index.html' },
    'before-host-exit',
  )) as { files: string[] };
  assert(result.files.includes('index.html'));
  const birth = await processBirth(process.pid);
  assert(birth && owner);
  process.on('message', (message: { type?: string }) => {
    if (message.type === 'exit-host') process.exit(73); // Skip cleanup to exercise the real recovery path.
  });
  process.send?.({
    type: 'admission-host-ready',
    host: { pid: process.pid, birth, platform: process.platform },
    owner,
    admission: lease.admission,
  });
})().catch(async () => {
  await cleanup().catch(() => undefined);
  process.send?.({ type: 'admission-host-failed' }, () => process.exit(1));
});
