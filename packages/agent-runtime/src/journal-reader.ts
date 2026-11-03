import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { JournalRecord } from './model.ts';
import { restoreRuntime } from './state.ts';

/** Read the actual durable primary journal; never open a second writer or manufacture recovery. */
export async function readRuntimeJournal(path: string, sessionId: string, allowMissing = false) {
  if (!isAbsolute(path)) throw new Error('Model journal requires an absolute path');
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const entry = await lstat(path);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.nlink !== 1 ||
      (await realpath(path)) !== resolve(path)
    )
      throw new Error('Model journal is not a canonical regular file');
    handle = await open(path, 'r');
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > 67_108_864 ||
      before.ino !== entry.ino ||
      before.dev !== entry.dev
    )
      throw new Error('Model journal exceeds its read limit or changed identity');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await lstat(path);
    if (
      before.size !== bytes.length ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      after.ino !== current.ino ||
      after.dev !== current.dev ||
      after.size !== current.size ||
      after.mtimeMs !== current.mtimeMs ||
      after.ctimeMs !== current.ctimeMs ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      after.nlink !== 1 ||
      (bytes.length && bytes.at(-1) !== 10)
    )
      throw new Error('Model journal changed during inspection or has an incomplete tail');
    const records: JournalRecord[] = [];
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line) as JournalRecord;
      const { hash, ...payload } = record;
      if (
        record.schema !== 2 ||
        record.sessionId !== sessionId ||
        record.sequence !== records.length + 1 ||
        record.previous !== (records.at(-1)?.hash ?? '') ||
        hash !== createHash('sha256').update(JSON.stringify(payload)).digest('hex')
      )
        throw new Error('Invalid model journal chain');
      records.push(record);
    }
    return { records, state: restoreRuntime(records) };
  } catch (error) {
    if (allowMissing && !handle && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return { records: [] as JournalRecord[], state: restoreRuntime([]) };
    throw error;
  } finally {
    await handle?.close();
  }
}
