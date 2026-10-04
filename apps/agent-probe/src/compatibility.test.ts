import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TimelineEvent } from '@skaro/timeline';
import { fingerprint, readPerformed, recordingReport, summarize } from './compatibility.ts';
import { compareSchemas, schemaSnapshot } from './protocol-schema.ts';

test('canonical comparison ignores values but detects contract shape and new item kind', () => {
  assert.equal(
    fingerprint({ text: 'secret-a', id: 'id-a', time: 1 }),
    fingerprint({ time: 99, id: 'id-b', text: 'secret-b' }),
  );
  assert.notEqual(fingerprint({ text: 'a' }), fingerprint({ text: 'a', extra: true }));
  const base = {
    id: '1',
    turnId: 'turn',
    status: 'done' as const,
    startedAt: 0,
    native: { agent: 'codex', type: 'unknown', ref: 'ref' },
  };
  const row: TimelineEvent = {
    t: 'item.upsert',
    item: { ...base, kind: 'unknown', raw: { token: 'secret' } },
  };
  const summary = summarize([row, row]);
  assert.equal(summary.unknown, 1);
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  const other = summarize([{ t: 'item.upsert', item: { ...base, kind: 'tool', name: 'tool' } }]);
  assert.notDeepEqual(summary.signatures, other.signatures);
});

test('a completed failed turn and empty/error recording cannot pass compatibility', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skaro-compatibility-test-'));
  try {
    const message = {
      t: 'item.upsert',
      item: { id: 'reply', kind: 'message', role: 'agent', text: 'ok' },
    };
    const write = (outcome: string, error?: string) => {
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ error }));
      writeFileSync(
        join(dir, 'canonical.jsonl'),
        [message, { t: 'turn.completed', turnId: 'turn', outcome }]
          .map((event) => JSON.stringify(event))
          .join('\n'),
      );
    };
    write('done');
    assert.equal(recordingReport(dir).ok, true);
    write('failed');
    assert.equal(recordingReport(dir).ok, false);
    write('done', 'private error');
    const result = recordingReport(dir);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('private error'), false);
    writeFileSync(join(dir, 'canonical.jsonl'), '');
    assert.equal(recordingReport(dir).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a successful arbitrary command cannot substitute for reading the fixture', () => {
  const base = {
    id: 'command',
    turnId: 'turn',
    status: 'done' as const,
    startedAt: 0,
    native: { agent: 'codex', type: 'commandExecution', ref: 'ref' },
  };
  const command = (output: string, exitCode = 0): TimelineEvent => ({
    t: 'item.upsert',
    item: { ...base, kind: 'command', command: 'Get-Content', output, outputLive: false, exitCode },
  });
  assert.equal(readPerformed([command('v24.0.0')]), false);
  assert.equal(readPerformed([command('export function add; Tiny calculator', 1)]), false);
  assert.equal(readPerformed([command('export function add; Tiny calculator')]), true);
});

test('protocol snapshot ignores key order and detects additions, removal and semantic changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skaro-schema-test-'));
  try {
    const path = join(dir, 'message.json');
    writeFileSync(path, '{"type":"object","required":["id"]}');
    const before = schemaSnapshot(dir);
    writeFileSync(path, '{"required":["id"],"type":"object"}');
    assert.deepEqual(schemaSnapshot(dir), before);
    writeFileSync(path, '{"required":["id","method"],"type":"object"}');
    writeFileSync(join(dir, 'added.json'), '{}');
    assert.deepEqual(compareSchemas({ ...before, 'removed.json': 'hash' }, schemaSnapshot(dir)), {
      added: ['added.json'],
      removed: ['removed.json'],
      changed: ['message.json'],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
