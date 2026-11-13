import { git } from './command.ts';
import { execFile } from 'node:child_process';

const exactObjects = { env: { GIT_NO_REPLACE_OBJECTS: '1' } };

/** Immutable object reads: never checkout, replacements, filters, textconv or external diff. */
export class GitSnapshot {
  readonly repo: string;
  readonly commit: string;
  constructor(repo: string, commit: string) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit))
      throw new Error('An exact commit SHA is required');
    this.repo = repo;
    this.commit = commit;
  }
  async verify(): Promise<void> {
    if (
      (await git(this.repo, ['cat-file', '-t', this.commit], exactObjects)).stdout.trim() !==
      'commit'
    )
      throw new Error('The exact historical object is not a commit');
  }
  async files(): Promise<string[]> {
    await this.verify();
    const result = await git(this.repo, ['ls-tree', '-r', '-z', this.commit], exactObjects);
    // Submodules and symbolic links are not file contents of this revision.
    return result.stdout.split('\0').flatMap((entry) => {
      const match = /^100(?:644|755) blob [a-f0-9]+\t([\s\S]+)$/.exec(entry);
      return match ? [match[1]!] : [];
    });
  }
  async read(path: string): Promise<Buffer> {
    if (!(await this.files()).includes(path))
      throw new Error('File is not available in this revision');
    const object = `${this.commit}:${path}`;
    const size = Number(
      (await git(this.repo, ['cat-file', '-s', object], exactObjects)).stdout.trim(),
    );
    if (!Number.isSafeInteger(size) || size < 0 || size > 8 * 1024 ** 2)
      throw new Error('Historical file exceeds the read limit');
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['cat-file', 'blob', object],
        {
          cwd: this.repo,
          encoding: 'buffer',
          maxBuffer: 8 * 1024 ** 2,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...exactObjects.env },
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });
  }
  /** Commit changes, NOT the uncommitted worktree-vs-HEAD fileDiff contract. */
  async diff(path: string): Promise<string> {
    await this.verify();
    if (
      !path ||
      path.split('/').some((part) => ['..', '.', ''].includes(part)) ||
      path.includes('\\')
    )
      throw new Error('Invalid historical path');
    // A merge's first-parent change is explicit; diff-tree's implicit merge result is empty.
    const lineage = (
      await git(this.repo, ['rev-list', '--parents', '-n', '1', this.commit], exactObjects)
    ).stdout
      .trim()
      .split(/\s+/);
    const revisions = lineage[1] ? [lineage[1], this.commit] : ['--root', this.commit];
    return (
      await git(
        this.repo,
        [
          '--literal-pathspecs',
          'diff-tree',
          '--no-commit-id',
          '--no-ext-diff',
          '--no-textconv',
          '--no-color',
          '-p',
          ...revisions,
          '--',
          path,
        ],
        exactObjects,
      )
    ).stdout;
  }
}
