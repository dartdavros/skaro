import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { collectDiagnostics } from './diagnostics';
import { dir, db, projectId, runId } from './task-run-test-support';

it('counts unique unknown events from real log files without exporting payloads or identifiers', async () => {
  const record = db.getRun(runId)!;
  const native = { agent: 'codex', type: 'secret-event-type', ref: 'secret-native-ref' };
  const raw = { filename: 'private-path', text: 'file-content-secret', token: 'secret-token' };
  const event = {
    t: 'item.upsert',
    item: { id: 'private-item-id', turnId: '', kind: 'unknown', native, raw },
  };
  const line = JSON.stringify({ ts: 0, dir: 'meta', line: { skaro: 'event', event } });
  await mkdir(join(dir, 'runs'), { recursive: true });
  await writeFile(join(dir, record.logPath), `${line}\n${line}\n{incomplete\n`);
  db.createChat({
    projectId,
    title: 'private-chat-title',
    agent: 'codex',
    logPath: 'missing.jsonl',
  });
  const report = await collectDiagnostics(db, dir, { app: 'test', electron: 'test', node: 'test' });
  expect(report.unknownEvents).toBe(1);
  expect(report.logs).toEqual({ scanned: 1, unavailable: 1, invalidLines: 1, projectionErrors: 0 });
  expect(report.unknown[0]?.shape).toEqual({ object: 1, string: 3 });
  const exported = JSON.stringify(report);
  for (const value of [
    ...Object.values(native).slice(1),
    ...Object.values(raw),
    'private-item-id',
    'private-chat-title',
    dir,
  ])
    expect(exported).not.toContain(value);
});
