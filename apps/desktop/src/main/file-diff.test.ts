import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileDiff } from './file-diff';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skaro-file-diff-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Skaro Test');
  git('config', 'user.email', 'test@skaro.dev');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(dir, 'a.ts'), 'one\ntwo\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

describe('fileDiff', () => {
  it('returns the uncommitted changes of a tracked file, or unchanged', async () => {
    const dir = repo();
    expect(await fileDiff(dir, 'a.ts')).toEqual({ status: 'unchanged', diff: '' });
    writeFileSync(join(dir, 'a.ts'), 'one\n2\n');
    const changed = await fileDiff(dir, join(dir, 'a.ts'));
    expect(changed.status).toBe('modified');
    expect(changed.diff).toMatch(/@@ -1,2 \+1,2 @@\n one\n-two\n\+2/);
  });

  it('shows an untracked file as wholly added and refuses paths outside the folder', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'new.ts'), 'x\ny\n');
    expect(await fileDiff(dir, 'new.ts')).toEqual({
      status: 'added',
      diff: '@@ -0,0 +1,2 @@\n+x\n+y',
    });
    await expect(fileDiff(dir, '../outside.ts')).rejects.toThrow();
  });
});
