import { afterEach, expect, it } from 'vitest';
import { writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startToolSession, type ToolSession } from './builtin-tools-support';
import { decodeText, encodeText } from '../../../../packages/agent-runtime/src/tools/text-file.ts';
import { ToolAccessQueue } from '../../../../packages/agent-runtime/src/tools/rw-lock.ts';

const sessions: ToolSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
}, 45_000);
const create = (path: string, content: string) => ({
  path,
  operation: 'create',
  expectedHash: null,
  content,
});

it('performs real create/read/search/context patch and detects a concurrent owner edit', async () => {
  const check = await startToolSession('auto');
  sessions.push(check);
  await check.tool('apply_patch', create('work.txt', 'Alpha\r\nBeta\r\n'));
  const first = await check.tool('read_file', { path: 'work.txt', maxLines: 1 });
  expect(first.text).toBe('Alpha');
  expect(first.nextLine).toBe(2);
  const search = await check.tool('search_text', { text: 'Beta' });
  expect(search.matches).toEqual([{ path: 'work.txt', line: 2, text: 'Beta' }]);
  const change = await check.tool('apply_patch', {
    path: 'work.txt',
    operation: 'update',
    expectedHash: first.hash,
    changes: [{ before: 'Beta', after: 'Gamma' }],
  });
  expect(await readFile(join(check.workspace, 'work.txt'), 'utf8')).toBe('Alpha\r\nGamma\r\n');
  await writeFile(join(check.workspace, 'work.txt'), 'Owner edit\n');
  await expect(
    check.tool('apply_patch', {
      path: 'work.txt',
      operation: 'update',
      expectedHash: change.hash,
      changes: [{ before: 'Gamma', after: 'Lost owner edit' }],
    }),
  ).rejects.toThrow('changed');
  expect(await readFile(join(check.workspace, 'work.txt'), 'utf8')).toBe('Owner edit\n');
  await check.tool('apply_patch', create('.gitignore', 'ignored.txt\n'));
  await check.tool('apply_patch', create('ignored.txt', 'Ignored by normal discovery'));
  const found = await check.tool('find_files', { pattern: '.txt' });
  expect(found.files).toEqual(['work.txt']);
  const long = '😀'.repeat(25000);
  await check.tool('apply_patch', create('large.data', long));
  const page = await check.tool('read_file', { path: 'large.data' });
  expect(String(page.text)).toHaveLength(32768);
  const rest = await check.tool('read_file', {
    path: 'large.data',
    startLine: page.nextLine,
    column: page.nextColumn,
  });
  expect(String(page.text) + String(rest.text)).toBe(long);
}, 45_000);

it('rejects scope traversal, metadata writes, linked paths, invalid schemas and read-only mutation', async () => {
  const check = await startToolSession();
  sessions.push(check);
  await expect(check.tool('read_file', { path: '../session.jsonl' })).rejects.toThrow(
    'Unsafe path',
  );
  await expect(check.tool('apply_patch', create('.git/config', 'forbidden'))).rejects.toThrow(
    'Protected',
  );
  await expect(check.tool('apply_patch', create('.skaro/task.md', 'forbidden'))).rejects.toThrow(
    'Protected',
  );
  await expect(check.tool('apply_patch', create('.git./config', 'forbidden'))).rejects.toThrow(
    process.platform === 'win32' ? 'aliases' : 'ENOENT',
  );
  await symlink(check.directory, join(check.workspace, 'linked'), 'junction');
  await expect(check.tool('read_file', { path: 'linked/session.jsonl' })).rejects.toThrow(
    'not traversed',
  );
  await expect(check.tool('read_file', { path: 'anything', unknown: true })).rejects.toThrow(
    'Invalid arguments',
  );
  await expect(check.tool('missing_tool', {})).rejects.toThrow('Unknown tool');
  await expect(check.tool('view_image', { path: 'anything.png' })).rejects.toThrow('not verified');
  const readonly = await startToolSession('full', true);
  sessions.push(readonly);
  await expect(readonly.tool('apply_patch', create('file.txt', 'forbidden'))).rejects.toThrow(
    'Read-only',
  );
}, 45_000);

it('persists actual questions and plans and revokes a waiting tool without a late action', async () => {
  const check = await startToolSession('ask');
  sessions.push(check);
  const question = check.tool(
    'ask_user',
    {
      questions: [
        {
          id: 'choice',
          header: 'Choice',
          text: 'Continue?',
          multi: false,
          allowFreeText: false,
          options: [{ label: 'Yes' }],
        },
      ],
    },
    'question',
  );
  await expect
    .poll(() =>
      check.events.find(
        (event) => event.t === 'interaction.opened' && event.interaction.id === 'question-question',
      ),
    )
    .toBeDefined();
  await check.session.respond('question-question', {
    kind: 'question',
    answers: { choice: ['Yes'] },
  });
  expect(await question).toEqual({ kind: 'question', answers: { choice: ['Yes'] } });
  const steps = [{ id: 'verify', text: 'Verify', status: 'active' }];
  await check.tool('update_plan', { steps });
  expect(check.events).toContainEqual({ t: 'plan.updated', steps });
  const pending = check.tool(
    'apply_patch',
    create('cancelled.txt', 'must not appear'),
    'cancelled',
  );
  const failed = expect(pending).rejects.toThrow('revoked');
  await expect
    .poll(() =>
      check.events.find(
        (event) =>
          event.t === 'interaction.opened' && event.interaction.id === 'approval-cancelled',
      ),
    )
    .toBeDefined();
  await check.session.interrupt();
  await failed;
  await check.session.respond('approval-cancelled', { kind: 'approval', choice: 'allow_once' });
  await expect(readFile(join(check.workspace, 'cancelled.txt'))).rejects.toThrow();
}, 45_000);

it('preserves UTF BOM/encoding and serializes writers while independent readers overlap', async () => {
  for (const bytes of [
    Buffer.from([0xef, 0xbb, 0xbf, 65, 13, 10]),
    Buffer.from([0xff, 0xfe, 65, 0, 13, 0, 10, 0]),
  ]) {
    const text = decodeText(bytes);
    expect(encodeText(text.text, text)).toEqual(bytes);
  }
  const queue = new ToolAccessQueue();
  const signal = new AbortController().signal;
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = queue.run(false, signal, async () => {
    order.push('read-a');
    await gate;
  });
  const b = queue.run(false, signal, async () => {
    order.push('read-b');
    await gate;
  });
  const c = queue.run(true, signal, async () => {
    order.push('write');
  });
  await Promise.resolve();
  expect(order).toEqual(['read-a', 'read-b']);
  release();
  await Promise.all([a, b, c]);
  expect(order).toEqual(['read-a', 'read-b', 'write']);
});
