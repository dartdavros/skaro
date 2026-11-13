import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { c4Hash } from '@skaro/core';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { background } from '../background/client';
import { coordinatorSourceAudit } from './coordinator-source-audit';

const item = 'skaro-c4-9193bb92-7847-47e6-92d2-43910ca51f36';
const packet = '097a69c9-e75f-4617-8bb2-408a4f7616d4';
const fingerprint = '326adeab9055c79426c7ab0ce7ea3c9a1e4a4e0da173e16448b422c8ed563f79';
const chat = '6feeb9d9-1dc8-4453-a6c9-ce839488c07c';

/** Owner explicitly approved this immutable real package, rename and normal T-012 submission. */
export async function applyC4CoordinationBaseline(s: Services, project: string) {
  const context = s.projects.get(project),
    handlers = sessionHandlers(s);
  await handlers['chat.interrupt'](project, chat);
  const original = await background(s.dataDir, 'c4.package', project, item);
  assert.equal(original.id, packet);
  assert.deepEqual(
    original.files.map((f) => f.path),
    ['c4/model.json'],
  );
  const exported = JSON.parse(
    await readFile(
      join(
        s.dataDir,
        'verification',
        'c4-coordination-a0b4ea4b-a899-4142-80c4-768458a7edf8',
        'baseline-proposal.json',
      ),
      'utf8',
    ),
  );
  assert.deepEqual(original, exported, 'Apply exactly the package presented to the owner');
  const source = await coordinatorSourceAudit(context.root);
  const artifacts = await context.store.load();
  const documents = c4Hash(
    JSON.stringify({
      architecture: artifacts.architecture,
      specs: artifacts.specs,
      adrs: artifacts.adrs,
    }),
  );
  try {
    const existing = (await s.c4.records(project, chat)).find((r) => r.item.id === item)!;
    if (existing.item.state !== 'applied')
      await handlers['c4.decide'](project, item, 'apply', fingerprint);
    context.invalidate();
    const after = await context.store.load();
    assert.equal(after.c4?.revision, 1);
    assert.equal(after.c4?.questions.length, 9);
    assert.deepEqual(await coordinatorSourceAudit(context.root), source);
    assert.equal(
      c4Hash(
        JSON.stringify({ architecture: after.architecture, specs: after.specs, adrs: after.adrs }),
      ),
      documents,
    );
    const record = (await s.c4.records(project, chat)).find((r) => r.item.id === item)!;
    assert.equal(record.item.state, 'applied');
    // Normal decision replay must not create another revision or application effect.
    // The public queue correctly removes decided cards; the durable executor handles recovery replay.
    await s.c4.decide(project, item, 'apply', fingerprint);
    assert.equal((await context.store.load()).c4?.revision, 1);
    assert.equal(
      c4Hash(await readFile(join(context.root, '.skaro', 'c4', 'model.json'), 'utf8')),
      c4Hash(original.files[0]!.after),
    );
    return {
      item,
      packet,
      fingerprint,
      revision: after.c4.revision,
      questions: after.c4.questions.length,
      source,
      documents,
      replayIdempotent: true,
    };
  } finally {
    await handlers['chat.interrupt'](project, chat);
  }
}
