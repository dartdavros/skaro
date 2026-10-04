// The current changes of one file in a working folder, for "Обновить" in the diff window: the
// file may have changed after the agent's turn (another turn, the user's own edits).

import { git } from '@skaro/core';
import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import type { FileDiff } from '../shared/ipc';
import { inside } from './files';

/** Untracked files show as wholly added, like `git diff` shows a new tracked one. */
function addedFile(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n');
}

/**
 * Uncommitted changes of `path` against HEAD (a task's worktree, the project folder of a chat);
 * an untracked file is all added, a file without changes is `unchanged`.
 */
export async function fileDiff(cwd: string, path: string): Promise<FileDiff> {
  const abs = inside(cwd, path);
  if (!abs) throw new Error('the file is outside the working folder');
  const rel = relative(cwd, abs).split(sep).join('/');
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', rel], { allowFail: true });
  if (tracked.code !== 0) {
    const text = await readFile(abs, 'utf8').catch(() => undefined);
    return text === undefined
      ? { status: 'unchanged', diff: '' }
      : { status: 'added', diff: addedFile(text) };
  }
  const head = await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true });
  const base = head.code === 0 ? ['HEAD'] : [];
  const result = await git(
    cwd,
    ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', ...base, '--', rel],
    { allowFail: true },
  );
  const diff = result.stdout.replace(/\r\n/g, '\n');
  if (!diff.trim()) return { status: 'unchanged', diff: '' };
  const status = /^deleted file mode/m.test(diff)
    ? 'deleted'
    : /^new file mode/m.test(diff)
      ? 'added'
      : 'modified';
  return { status, diff };
}
