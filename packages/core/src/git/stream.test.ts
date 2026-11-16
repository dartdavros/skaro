import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { git, GitError } from './command.ts';
import { gitStream } from './stream.ts';

it('streams more than 64 MiB of actual repository blobs without buffering or changing bytes', async () => {
  const root = process.cwd();
  const object = 'HEAD:pnpm-lock.yaml';
  const content = (await git(root, ['cat-file', 'blob', object])).stdout;
  const bytes = Buffer.byteLength(content);
  const id = (await git(root, ['rev-parse', object])).stdout.trim();
  const frame = `${id} blob ${bytes}\n${content}\n`;
  const count = Math.ceil((65 * 1024 * 1024) / Buffer.byteLength(frame));
  const expected = createHash('sha256');
  for (let i = 0; i < count; i++) expected.update(frame);
  const actual = createHash('sha256');
  let received = 0;
  await gitStream(
    root,
    ['cat-file', '--batch'],
    (chunk) => {
      received += Buffer.byteLength(chunk);
      actual.update(chunk);
    },
    { input: `${object}\n`.repeat(count) },
  );
  expect(received).toBeGreaterThan(64 * 1024 * 1024);
  expect(actual.digest('hex')).toBe(expected.digest('hex'));
}, 30_000);

it('bounds diagnostics while retaining the native Git failure cause', async () => {
  const content = (await git(process.cwd(), ['show', 'HEAD:README.md'])).stdout;
  const cause = Object.assign(new Error('stdout maxBuffer length exceeded'), {
    code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  });
  const error = new GitError(
    ['diff', '--binary'],
    { stdout: content.repeat(100), stderr: '', code: 1 },
    cause,
  );
  expect(error.message.length).toBeLessThan(9000);
  expect(error.message).toContain('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  expect(error.cause).toBe(cause);
  await expect(
    gitStream(
      process.cwd(),
      ['rev-parse', '--verify', 'refs/skaro/no-such-verification-ref'],
      () => {},
    ),
  ).rejects.toBeInstanceOf(GitError);
});
