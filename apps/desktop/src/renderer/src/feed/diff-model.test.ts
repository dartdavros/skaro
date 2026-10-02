import { expect, it } from 'vitest';
import { fileDiffLines } from './diff-model';

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
