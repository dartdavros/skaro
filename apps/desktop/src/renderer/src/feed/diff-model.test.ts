import { expect, it } from 'vitest';
import { fileDiffLines, numberedDiffLines } from './diff-model';

it('retains hunks, signs, context and separators while excluding unified headers', () => {
  const lines = fileDiffLines({
    type: 'file',
    id: 'file',
    path: 'a.txt',
    change: 'update',
    status: 'done',
    items: [],
    diffs: [
      'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\r\n-old\r\n+new\r\n context\r\n',
      'plain\ntext\n',
    ],
  });
  expect(lines).toEqual([
    { kind: 'hunk', sign: '', text: '@@ -1 +1 @@' },
    { kind: 'del', sign: '−', text: 'old' },
    { kind: 'add', sign: '+', text: 'new' },
    { kind: 'ctx', sign: '', text: 'context' },
    { kind: 'sep', sign: '', text: '' },
    { kind: 'ctx', sign: '', text: 'plain' },
    { kind: 'ctx', sign: '', text: 'text' },
  ]);
});

it('numbers old and new lines from the hunk headers and a new file from 1', () => {
  const lines = numberedDiffLines(
    ['--- a/a.ts\n+++ b/a.ts\n@@ -10,3 +10,3 @@ fn\n keep\n-old\n+new\n tail\n'],
    'update',
  );
  expect(lines.map((l) => [l.kind, l.old, l.new])).toEqual([
    ['hunk', undefined, undefined],
    ['ctx', 10, 10],
    ['del', 11, undefined],
    ['add', undefined, 11],
    ['ctx', 12, 12],
  ]);
  const created = numberedDiffLines(['one\ntwo\n'], 'add');
  expect(created.map((l) => [l.kind, l.old, l.new])).toEqual([
    ['add', undefined, 1],
    ['add', undefined, 2],
  ]);
});
