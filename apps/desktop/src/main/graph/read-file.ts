import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isMainThread } from 'node:worker_threads';

export function readGraphFile(path: string): Promise<Buffer>;
export function readGraphFile(path: string, encoding: 'utf8'): Promise<string>;
/**
 * A graph worker can be terminated at any JS boundary (timeout/cancellation).
 * fs.promises.readFile can then lose an opened FileHandle before its close runs,
 * leaking it into the host process and preventing Windows file replacement.
 * Synchronous reads leave no pending FileHandle promises; Node also tracks their
 * raw descriptors for cleanup if termination interrupts the synchronous reader.
 * Only the dedicated worker uses them; callers on main retain asynchronous I/O.
 */
export async function readGraphFile(path: string, encoding?: 'utf8'): Promise<Buffer | string> {
  if (isMainThread) return encoding ? readFile(path, encoding) : readFile(path);
  return encoding ? readFileSync(path, encoding) : readFileSync(path);
}
